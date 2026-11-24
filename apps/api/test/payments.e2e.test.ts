import { createHmac } from "node:crypto"
import { parseSignatureHeader } from "@yaropay/core/payments"
import { eq } from "drizzle-orm"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { connections, products, transactions, webhookDeliveries } from "../src/database/schema.js"
import { PaymentsService } from "../src/payments/payments.service.js"
import { createProduct, createTestApp, FLUTTERWAVE_TEST, installGateway, PAYSTACK_TEST, setupOwner, type TestApp } from "./helpers.js"

const HOOK = "https://shop.example.test/hooks/yaropay"

function paystackSignature(body: string) {
  return createHmac("sha512", PAYSTACK_TEST.secretKey).update(body).digest("hex")
}

function verifyProductSignature(header: string, body: string, secret: string) {
  const parsed = parseSignatureHeader(header)!
  const expected = createHmac("sha256", secret).update(`${parsed.t}.${body}`).digest("hex")
  return parsed.v1.includes(expected) && Math.abs(Date.now() / 1000 - parsed.t) < 300
}

describe("payments through Paystack", () => {
  let t: TestApp
  let owner: Awaited<ReturnType<typeof setupOwner>>["agent"]
  let conId: string
  let product: Awaited<ReturnType<typeof createProduct>>

  const start = (body: Record<string, unknown> = {}, key = product.testApiKey) =>
    t
      .http()
      .post(`/v1/products/${product.product.id}/payments`)
      .set("authorization", `Bearer ${key}`)
      .send({ amount: 1_500_000, currency: "NGN", email: "kemi@example.test", metadata: { orderId: "1042" }, ...body })

  const postWebhook = (payload: unknown, signature?: string) => {
    const body = JSON.stringify(payload)
    return t
      .http()
      .post(`/v1/webhooks/paystack/${conId}`)
      .set("content-type", "application/json")
      .set("x-paystack-signature", signature ?? paystackSignature(body))
      .send(body)
  }

  beforeEach(async () => {
    t = await createTestApp()
    owner = (await setupOwner(t)).agent
    conId = (await installGateway(owner, "paystack")).id
    product = await createProduct(owner, conId)
  })
  afterEach(async () => {
    await t.close()
  })

  it("starts a payment with the product's test key and YaroPay's callback", async () => {
    const res = await start().expect(201)
    expect(res.body).toMatchObject({ productId: product.product.id, gateway: "paystack", mode: "test", status: "pending", amount: 1_500_000 })
    expect(res.body.reference).toMatch(/^SHW_[0-9A-Z]{10}$/)
    expect(res.body.authorizationUrl).toBe(`https://checkout.paystack.test/${res.body.reference}`)

    const init = t.net.sentTo("https://api.paystack.test/transaction/initialize")[0]
    expect(init.headers.authorization).toBe(`Bearer ${PAYSTACK_TEST.secretKey}`)
    const sent = JSON.parse(init.body)
    expect(sent).toMatchObject({
      email: "kemi@example.test",
      amount: 1_500_000,
      currency: "NGN",
      reference: res.body.reference,
      callback_url: `https://pay.example.test/v1/callback/${product.product.id}/paystack`,
      metadata: {
        orderId: "1042",
        yaropay_product: product.product.id,
        // The cancel link carries a token only YaroPay can make, so a cancellation can't be forged.
        cancel_action: expect.stringMatching(new RegExp(`^https://pay\\.example\\.test/v1/callback/${product.product.id}/paystack\\?outcome=cancelled&ct=[0-9a-f]{32}$`)),
      },
    })
  })

  it("authenticates product servers by key and mode", async () => {
    await start({}, "ypk_test_wrongwrongwrongwrongwrongwrong").expect(401)
    await t.http().post(`/v1/products/${product.product.id}/payments`).send({ amount: 100, currency: "NGN", email: "a@example.test" }).expect(401)
    const live = await start({}, product.apiKey).expect(409)
    expect(live.body.error.message).toMatch(/no live gateway/)
    const other = await createProduct(owner, conId, { name: "Other", referencePrefix: "OTH", colorSlot: 2 })
    await t.http().post(`/v1/products/${product.product.id}/payments`).set("authorization", `Bearer ${other.testApiKey}`).send({ amount: 100, currency: "NGN", email: "a@example.test" }).expect(401)
    const invalid = await start({ amount: 15.5 }).expect(422)
    expect(invalid.body.error.fields.amount).toBeTruthy()
    await start({ reference: "LDG_ORDER1042" }).expect(422)
  })

  it("replays the same payment for the same Idempotency-Key", async () => {
    const a = await start().set("idempotency-key", "order-1042").expect(201)
    const b = await start().set("idempotency-key", "order-1042").expect(200)
    expect(b.body.id).toBe(a.body.id)
    expect(t.net.sentTo("https://api.paystack.test/transaction/initialize")).toHaveLength(1)
  })

  it("callback verifies, redirects the customer and forwards one signed event", async () => {
    const { reference, id } = (await start().expect(201)).body
    t.net.setStatus(reference, "success")
    const cb = await t.http().get(`/v1/callback/${product.product.id}/paystack?trxref=${reference}&reference=${reference}`).expect(303)
    const to = new URL(cb.headers.location)
    expect(to.origin + to.pathname).toBe("https://shop.example.test/paid")
    expect(to.searchParams.get("reference")).toBe(reference)
    expect(to.searchParams.get("status")).toBe("success")

    expect(await t.deliveries.runDue()).toBe(1)
    const [hook] = t.net.sentTo(HOOK)
    expect(hook.headers["x-yaropay-event"]).toBe("payment.succeeded")
    expect(verifyProductSignature(hook.headers["x-yaropay-signature"], hook.body, product.signingSecret)).toBe(true)
    const event = JSON.parse(hook.body)
    expect(event).toMatchObject({ type: "payment.succeeded", mode: "test", data: { id, reference, status: "success", amount: 1_500_000, channel: "card", metadata: { orderId: "1042" } } })

    // The gateway's webhook arrives afterwards: stored and routed, but no second delivery.
    const payload = { event: "charge.success", data: { id: 1, reference, amount: 1_500_000, currency: "NGN", status: "success", channel: "card", metadata: { yaropay_product: product.product.id } } }
    expect((await postWebhook(payload).expect(200)).body).toMatchObject({ routed: true })
    expect((await postWebhook(payload).expect(200)).body).toMatchObject({ duplicate: true })
    await t.deliveries.runDue()
    expect(t.net.sentTo(HOOK)).toHaveLength(1)

    const detail = (await owner.get(`/api/transactions/${reference}`).expect(200)).body
    expect(detail.status).toBe("success")
    expect(detail.timeline.map((s: { kind: string }) => s.kind)).toEqual(["initialized", "redirected", "callback", "verified", "forwarded", "webhook_received", "routed"])
    expect(detail.events).toHaveLength(1)
    expect(detail.deliveries[0]).toMatchObject({ state: "delivered", statusCode: 200, attempts: 1 })

    const status = await t.http().get(`/v1/products/${product.product.id}/payments/${reference}`).set("authorization", `Bearer ${product.testApiKey}`).expect(200)
    expect(status.body).toMatchObject({ status: "success", authorizationUrl: null })
  })

  it("settles from the webhook first, after confirming with the gateway", async () => {
    const { reference } = (await start().expect(201)).body
    t.net.setStatus(reference, "success")
    const payload = { event: "charge.success", data: { id: 7, reference, amount: 1_500_000, currency: "NGN", status: "success", channel: "bank_transfer", metadata: { yaropay_product: product.product.id } } }
    await postWebhook(payload).expect(200)
    expect(t.net.sentTo(`https://api.paystack.test/transaction/verify/${reference}`)).toHaveLength(1)
    await t.deliveries.runDue()
    const [delivery] = await t.db.select().from(webhookDeliveries)
    expect(delivery.eventId).toBeTruthy()

    const cb = await t.http().get(`/v1/callback/${product.product.id}/paystack?reference=${reference}`).expect(303)
    expect(new URL(cb.headers.location).searchParams.get("status")).toBe("success")
    expect(await t.db.select().from(webhookDeliveries)).toHaveLength(1)
  })

  it("asks the gateway to retry when it cannot confirm a webhook yet", async () => {
    const { reference } = (await start().expect(201)).body
    // Gateway says the payment is still ongoing: the webhook is not trusted on its own.
    const payload = { event: "charge.success", data: { id: 8, reference, amount: 1_500_000, currency: "NGN", status: "success", metadata: { yaropay_product: product.product.id } } }
    t.net.payments.delete(reference)
    await postWebhook(payload).expect(503)
    t.net.addDirectPayment({ reference, amount: 1_500_000, currency: "NGN", status: "success", metadata: {}, email: "kemi@example.test" })
    expect((await postWebhook(payload).expect(200)).body).toMatchObject({ routed: true })
    expect((await owner.get(`/api/transactions/${reference}`).expect(200)).body.status).toBe("success")
  })

  it("rejects bad signatures and tells the gateway admins", async () => {
    const res = await postWebhook({ event: "charge.success", data: { reference: "SHW_FORGED0001", amount: 1 } }, "deadbeef").expect(401)
    expect(res.body.error.message).toBe("Invalid signature")
    const events = (await owner.get("/api/webhooks/events?mode=test").expect(200)).body
    expect(events.rows[0]).toMatchObject({ signatureValid: false, productId: null })
    const notes = (await owner.get("/api/notifications").expect(200)).body.rows
    expect(notes[0]).toMatchObject({ type: "event.signature_invalid", severity: "critical" })
  })

  it("holds events that match no product as unrouted", async () => {
    const res = await postWebhook({ event: "charge.success", data: { id: 9, reference: "T1234567890", amount: 500000, currency: "NGN", metadata: {} } }).expect(200)
    expect(res.body).toMatchObject({ routed: false })
    const events = (await owner.get("/api/webhooks/events?mode=test&routing=unrouted").expect(200)).body
    expect(events.total).toBe(1)
    expect((await owner.get("/api/notifications").expect(200)).body.rows[0].type).toBe("event.unrouted")
    expect(t.net.sentTo(HOOK)).toHaveLength(0)
  })

  it("sends cancelled checkouts to the cancel page", async () => {
    const { reference } = (await start().expect(201)).body
    // The customer follows the cancel link Paystack got from YaroPay (signed with a token).
    const cancelAction = JSON.parse(t.net.sentTo("https://api.paystack.test/transaction/initialize")[0].body).metadata.cancel_action as string
    const link = new URL(cancelAction)
    const cb = await t.http().get(`${link.pathname}${link.search}&reference=${reference}`).expect(303)
    expect(cb.headers.location).toMatch(/^https:\/\/shop\.example\.test\/cart\?/)
    expect(new URL(cb.headers.location).searchParams.get("status")).toBe("cancelled")
    await t.deliveries.runDue()
    expect(JSON.parse(t.net.sentTo(HOOK)[0].body).type).toBe("payment.abandoned")
  })

  it("ignores a cancellation it can't prove, and lets a real payment win", async () => {
    const { reference } = (await start().expect(201)).body
    // Someone who only knows the reference opens the callback with outcome=cancelled (no token, or a made-up one).
    for (const forged of ["", "&ct=00000000000000000000000000000000"]) {
      const cb = await t.http().get(`/v1/callback/${product.product.id}/paystack?outcome=cancelled&reference=${reference}${forged}`).expect(303)
      expect(new URL(cb.headers.location).searchParams.get("status")).toBe("cancelled")
    }
    await t.deliveries.runDue()
    expect(t.net.sentTo(HOOK)).toHaveLength(0)
    const open = (await owner.get(`/api/transactions/${reference}`).expect(200)).body
    expect(open.status).toBe("pending")
    expect(open.timeline.some((s: { title: string }) => s.title === "Cancellation not confirmed")).toBe(true)

    // If the gateway says it was paid, a "cancelled" callback settles it as paid.
    t.net.setStatus(reference, "success")
    const paid = await t.http().get(`/v1/callback/${product.product.id}/paystack?outcome=cancelled&reference=${reference}`).expect(303)
    expect(new URL(paid.headers.location).pathname).toBe("/paid")
    expect((await owner.get(`/api/transactions/${reference}`).expect(200)).body.status).toBe("success")
  })

  it("caps badly signed webhook posts without ever slowing down real ones", async () => {
    const forged = (n: number) => ({ event: "charge.success", data: { id: n, reference: `SHW_FORGED${n}`, amount: 1, currency: "NGN", metadata: {} } })
    const statuses: number[] = []
    for (let i = 0; i < 25; i++) {
      const body = JSON.stringify(forged(i))
      const res = await t
        .http()
        .post(`/v1/webhooks/paystack/${conId}`)
        .set("content-type", "application/json")
        .set("x-forwarded-for", "203.0.113.7")
        .set("x-paystack-signature", "f".repeat(128))
        .send(body)
      statuses.push(res.status)
    }
    expect(statuses.slice(0, 20).every((s) => s === 401)).toBe(true)
    expect(statuses.slice(20).every((s) => s === 429)).toBe(true)
    const stored = async () => ((await owner.get("/api/webhooks/events?mode=test&pageSize=100").expect(200)).body.rows as { signatureValid: boolean }[]).filter((e) => !e.signatureValid).length
    expect(await stored()).toBe(20)

    // Other senders still get 401, but the account's storage budget is spent: nothing more is stored.
    const other = JSON.stringify(forged(99))
    await t.http().post(`/v1/webhooks/paystack/${conId}`).set("content-type", "application/json").set("x-forwarded-for", "198.51.100.4").set("x-paystack-signature", "e".repeat(128)).send(other).expect(401)
    expect(await stored()).toBe(20)

    // A correctly signed event from the throttled address goes straight through.
    const { reference } = (await start().expect(201)).body
    t.net.setStatus(reference, "success")
    const real = JSON.stringify({ event: "charge.success", data: { id: 1, reference, amount: 1_500_000, currency: "NGN", status: "success", channel: "card", metadata: {} } })
    const ok = await t
      .http()
      .post(`/v1/webhooks/paystack/${conId}`)
      .set("content-type", "application/json")
      .set("x-forwarded-for", "203.0.113.7")
      .set("x-paystack-signature", paystackSignature(real))
      .send(real)
      .expect(200)
    expect(ok.body).toMatchObject({ routed: true })
  })

  it("records oversized badly signed posts by size only", async () => {
    const big = JSON.stringify({ event: "charge.success", data: { reference: "SHW_BIG", padding: "x".repeat(6_000) } })
    await postWebhook(JSON.parse(big), "0".repeat(128)).expect(401)
    const [event] = (await owner.get("/api/webhooks/events?mode=test").expect(200)).body.rows as { id: string; payload: unknown; signatureValid: boolean }[]
    expect(event.signatureValid).toBe(false)
    expect(event.payload).toEqual({ truncated: true, bytes: big.length })
  })

  it("re-checks a payment with the gateway on request, whatever its status", async () => {
    const payments = t.app.get(PaymentsService)
    const { reference } = (await start().expect(201)).body
    const row = async () => (await t.db.select().from(transactions).where(eq(transactions.reference, reference)))[0]

    t.net.setStatus(reference, "success")
    const first = await payments.recheck(await row(), "Asked by Kemi via Claude")
    expect(first).toMatchObject({ checked: true, changed: true })
    expect(first.row.status).toBe("success")
    expect(first.row.timeline.at(-1)).toMatchObject({ kind: "verified", title: "Status checked with the gateway", detail: "Asked by Kemi via Claude" })
    expect(await t.deliveries.runDue()).toBe(1)
    expect(JSON.parse(t.net.sentTo(HOOK)[0].body).type).toBe("payment.succeeded")

    // Already settled: checked again, nothing moves and nothing new is sent.
    const again = await payments.recheck(await row(), "Asked again")
    expect(again).toMatchObject({ checked: true, changed: false })
    expect(await t.deliveries.runDue()).toBe(0)

    // A payment marked abandoned that the customer paid after all becomes successful.
    const late = (await start().expect(201)).body.reference as string
    await t.db.update(transactions).set({ status: "abandoned" }).where(eq(transactions.reference, late))
    t.net.setStatus(late, "success")
    const [abandoned] = await t.db.select().from(transactions).where(eq(transactions.reference, late))
    expect((await payments.recheck(abandoned, "Asked by Kemi via Claude")).row.status).toBe("success")
  })

  it("names who started a payment when it isn't the product server", async () => {
    const [row] = await t.db.select().from(products).where(eq(products.id, product.product.id))
    const { payment } = await t.app
      .get(PaymentsService)
      .create(row, "test", { amount: 250_000, currency: "NGN", email: "ada@example.test" }, "mcp_test_1", { title: "Created by Ada via Claude", detail: "Approved in YaroPay" })
    const detail = (await owner.get(`/api/transactions/${payment.reference}`).expect(200)).body
    expect(detail.timeline[0]).toMatchObject({ kind: "initialized", title: "Created by Ada via Claude", detail: "Approved in YaroPay" })
    // The product server's own payments keep the usual first step.
    const own = (await start().expect(201)).body.reference
    expect((await owner.get(`/api/transactions/${own}`).expect(200)).body.timeline[0].title).toBe(`Initialised by ${product.product.name}`)
  })

  it("refuses to mark an underpaid payment as successful", async () => {
    const { reference } = (await start().expect(201)).body
    t.net.setStatus(reference, "success", { amount: 1_000 })
    const cb = await t.http().get(`/v1/callback/${product.product.id}/paystack?reference=${reference}`).expect(303)
    expect(new URL(cb.headers.location).pathname).toBe("/failed")
    const detail = (await owner.get(`/api/transactions/${reference}`).expect(200)).body
    expect(detail.status).toBe("failed")
    expect(detail.timeline.some((s: { title: string }) => s.title === "Amount check failed")).toBe(true)
  })

  it("records payments the product started directly (direct mode)", async () => {
    t.net.addDirectPayment({ reference: "SHW_DIRECT0001", amount: 250_000, currency: "NGN", status: "success", metadata: { yaropay_product: product.product.id }, email: "direct@example.test" })
    const cb = await t.http().get(`/v1/callback/${product.product.id}/paystack?reference=SHW_DIRECT0001`).expect(303)
    expect(new URL(cb.headers.location).searchParams.get("status")).toBe("success")
    const detail = (await owner.get("/api/transactions/SHW_DIRECT0001").expect(200)).body
    expect(detail).toMatchObject({ status: "success", amount: 250_000, productId: product.product.id })
    // A reference with another product's prefix is not imported.
    const other = await t.http().get(`/v1/callback/${product.product.id}/paystack?reference=LDG_SOMETHING1`).expect(303)
    expect(new URL(other.headers.location).searchParams.get("status")).toBe("failed")
  })

  it("retries failing deliveries, replays them on demand and alerts after the last attempt", async () => {
    const { reference } = (await start().expect(201)).body
    t.net.setStatus(reference, "success")
    t.net.endpointStatus.set(HOOK, 500)
    await t.http().get(`/v1/callback/${product.product.id}/paystack?reference=${reference}`).expect(303)
    await t.deliveries.runDue()
    let [d] = await t.db.select().from(webhookDeliveries)
    expect(d).toMatchObject({ state: "retrying", statusCode: 500, attempts: 1 })
    expect(d.nextRetryAt!.getTime()).toBeGreaterThan(Date.now() + 50_000)
    expect(await t.deliveries.runDue()).toBe(0)

    t.net.endpointStatus.set(HOOK, 200)
    const replay = await owner.post(`/api/webhooks/deliveries/${d.id}/replay`).expect(200)
    expect(replay.body).toMatchObject({ state: "delivered", statusCode: 200, attempts: 2 })

    // Exhaust the schedule on a second payment.
    const second = (await start().expect(201)).body.reference
    t.net.setStatus(second, "success")
    t.net.endpointStatus.set(HOOK, 503)
    await t.http().get(`/v1/callback/${product.product.id}/paystack?reference=${second}`).expect(303)
    ;[d] = (await t.db.select().from(webhookDeliveries)).filter((x) => x.state !== "delivered")
    await t.db.update(webhookDeliveries).set({ attempts: 7 }).where(eq(webhookDeliveries.id, d.id))
    await t.deliveries.runDue()
    ;[d] = await t.db.select().from(webhookDeliveries).where(eq(webhookDeliveries.id, d.id))
    expect(d).toMatchObject({ state: "failed", attempts: 8, nextRetryAt: null })
    const notes = (await owner.get("/api/notifications").expect(200)).body.rows
    expect(notes[0]).toMatchObject({ type: "delivery.failed", severity: "critical", productId: product.product.id })
    await t.jobs.runDue()
    expect(t.mailer.outbox.some((m) => m.subject.includes("stopped accepting events"))).toBe(true)
  })

  it("flags the gateway account when its keys are rejected", async () => {
    t.net.validKeys.clear()
    const res = await start().expect(502)
    expect(res.body.error.code).toBe("gateway_auth")
    const [con] = await t.db.select().from(connections).where(eq(connections.id, conId))
    expect(con.status).toBe("error")
    expect((await owner.get("/api/notifications").expect(200)).body.rows[0].type).toBe("gateway.error")
  })

  it("exports filtered payments as CSV without spreadsheet formulas", async () => {
    await start({ name: "=HYPERLINK(evil)" }).expect(201)
    const csv = await owner.get("/api/transactions/export.csv?mode=test").expect(200)
    expect(csv.headers["content-type"]).toMatch(/text\/csv/)
    const lines = csv.text.trim().split("\n")
    expect(lines[0]).toMatch(/^id,reference,created_at/)
    expect(lines[1]).toContain(`"'=HYPERLINK(evil)"`)
  })

  it("sends a signed test event from the dashboard", async () => {
    const res = await owner.post(`/api/products/${product.product.id}/test-webhook`).send({}).expect(200)
    expect(res.body).toMatchObject({ eventType: "test.ping", state: "delivered" })
    const [hook] = t.net.sentTo(HOOK)
    expect(verifyProductSignature(hook.headers["x-yaropay-signature"], hook.body, product.signingSecret)).toBe(true)
  })
})

describe("payments through Flutterwave", () => {
  let t: TestApp
  beforeEach(async () => {
    t = await createTestApp()
  })
  afterEach(async () => {
    await t.close()
  })

  it("uses major units, verifies the redirect by transaction id and checks verif-hash", async () => {
    const { agent: owner } = await setupOwner(t)
    const con = await installGateway(owner, "flutterwave")
    const product = await createProduct(owner, con.id, { name: "RideNow", referencePrefix: "RDN", successUrl: "ridenow://payment/success", failureUrl: "ridenow://payment/failed", cancelUrl: "" })
    const res = await t
      .http()
      .post(`/v1/products/${product.product.id}/payments`)
      .set("authorization", `Bearer ${product.testApiKey}`)
      .send({ amount: 650_000, currency: "GHS", email: "kofi@example.test", name: "Kofi Mensah" })
      .expect(201)
    const sent = JSON.parse(t.net.sentTo("https://api.flutterwave.test/v3/payments")[0].body)
    expect(sent).toMatchObject({ tx_ref: res.body.reference, amount: 6500, currency: "GHS", redirect_url: `https://pay.example.test/v1/callback/${product.product.id}/flutterwave` })
    expect(sent.meta.yaropay_product).toBe(product.product.id)

    const fake = t.net.payments.get(res.body.reference)!
    t.net.setStatus(res.body.reference, "successful")
    const cb = await t.http().get(`/v1/callback/${product.product.id}/flutterwave?status=successful&tx_ref=${res.body.reference}&transaction_id=${fake.id}`).expect(303)
    expect(cb.headers.location).toMatch(/^ridenow:\/\/payment\/success\?/)
    expect(t.net.sentTo(`https://api.flutterwave.test/v3/transactions/${fake.id}/verify`)).toHaveLength(1)
    const detail = (await owner.get(`/api/transactions/${res.body.reference}`).expect(200)).body
    expect(detail).toMatchObject({ status: "success", channel: "mobile_money", amount: 650_000 })

    const payload = JSON.stringify({ event: "charge.completed", data: { id: fake.id, tx_ref: res.body.reference, amount: 6500, currency: "GHS", status: "successful" } })
    await t.http().post(`/v1/webhooks/flutterwave/${con.id}`).set("content-type", "application/json").set("verif-hash", "wrong").send(payload).expect(401)
    await t.http().post(`/v1/webhooks/flutterwave/${con.id}`).set("content-type", "application/json").set("verif-hash", FLUTTERWAVE_TEST.secretHash).send(payload).expect(200)

    // Cancelled checkout: no cancel URL, so the customer lands on the failure page.
    const second = await t.http().post(`/v1/products/${product.product.id}/payments`).set("authorization", `Bearer ${product.testApiKey}`).send({ amount: 100_000, currency: "GHS", email: "kofi@example.test" }).expect(201)
    const cancelled = await t.http().get(`/v1/callback/${product.product.id}/flutterwave?status=cancelled&tx_ref=${second.body.reference}`).expect(303)
    expect(cancelled.headers.location).toMatch(/^ridenow:\/\/payment\/failed\?.*status=cancelled/)
    // Flutterwave doesn't confirm it yet, so the payment stays open...
    expect((await owner.get(`/api/transactions/${second.body.reference}`).expect(200)).body.status).toBe("pending")
    // ...and once Flutterwave reports the checkout cancelled, the cancellation counts.
    t.net.setStatus(second.body.reference, "cancelled")
    await t.http().get(`/v1/callback/${product.product.id}/flutterwave?status=cancelled&tx_ref=${second.body.reference}`).expect(303)
    expect((await owner.get(`/api/transactions/${second.body.reference}`).expect(200)).body.status).toBe("abandoned")
  })

  it("tests keys against the gateway before saving them", async () => {
    const { agent: owner } = await setupOwner(t)
    const ok = await owner.post("/api/connections/test").send({ gatewayId: "flutterwave", mode: "test", credentials: FLUTTERWAVE_TEST }).expect(200)
    expect(ok.body.ok).toBe(true)
    const rejected = await owner.post("/api/connections/test").send({ gatewayId: "paystack", mode: "test", credentials: { publicKey: "pk_test_000000000000000000000", secretKey: "sk_test_unknownunknownunknown" } }).expect(200)
    expect(rejected.body).toMatchObject({ ok: false, message: "Paystack rejected the secret key" })
    const wrongMode = await owner.post("/api/connections/test").send({ gatewayId: "paystack", mode: "live", credentials: PAYSTACK_TEST }).expect(200)
    expect(wrongMode.body.message).toMatch(/starts with pk_live_/)
  })
})
