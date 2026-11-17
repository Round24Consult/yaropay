import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { PAYPAL_FAKE } from "./fake-network.js"
import { createProduct, createTestApp, setupOwner, type TestApp } from "./helpers.js"

const transmission = (signature = PAYPAL_FAKE.validSignature) => ({
  "paypal-auth-algo": "SHA256withRSA",
  "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-fake",
  "paypal-transmission-id": "69cd13f0-d67a-11e5-baa3-778b53f4ae55",
  "paypal-transmission-sig": signature,
  "paypal-transmission-time": "2026-11-17T12:04:13Z",
})

describe("payments through PayPal (beta)", () => {
  let t: TestApp
  let owner: Awaited<ReturnType<typeof setupOwner>>["agent"]
  let conId: string
  let product: Awaited<ReturnType<typeof createProduct>>

  const start = () =>
    t
      .http()
      .post(`/v1/products/${product.product.id}/payments`)
      .set("authorization", `Bearer ${product.testApiKey}`)
      .send({ amount: 150_000, currency: "USD", email: "kemi@example.test", metadata: { orderId: "1042" } })

  const postWebhook = (event: unknown, signature?: string) => {
    let req = t.http().post(`/v1/webhooks/paypal/${conId}`).set("content-type", "application/json")
    for (const [k, v] of Object.entries(transmission(signature))) req = req.set(k, v)
    return req.send(JSON.stringify(event))
  }

  const captures = () => t.net.requests.filter((r) => r.url.startsWith("https://api.paypal.test/v2/checkout/orders/") && r.url.endsWith("/capture"))
  const orderFor = (reference: string) => [...t.net.paypalOrders.values()].find((o) => o.customId === reference)!

  beforeEach(async () => {
    t = await createTestApp()
    owner = (await setupOwner(t)).agent
    const con = await owner
      .post("/api/connections")
      .send({ gatewayId: "paypal", label: "Sandbox", mode: "test", credentials: { clientId: PAYPAL_FAKE.clientId, clientSecret: PAYPAL_FAKE.clientSecret, webhookId: PAYPAL_FAKE.webhookId } })
      .expect(201)
    conId = con.body.id
    product = await createProduct(owner, conId)
  })
  afterEach(async () => {
    await t.close()
  })

  it("creates an order and sends the customer to PayPal's approval page", async () => {
    const { reference, authorizationUrl } = (await start().expect(201)).body
    const order = orderFor(reference)
    expect(order.amount).toEqual({ currency_code: "USD", value: "1500.00" })
    expect(authorizationUrl).toBe(`https://www.paypal.test/checkoutnow?token=${order.id}`)
  })

  it("captures the approved order when the customer comes back, and only once", async () => {
    const { reference } = (await start().expect(201)).body
    const order = orderFor(reference)
    t.net.approvePayPal(order.id)
    const back = `/v1/callback/${product.product.id}/paypal?reference=${reference}&token=${order.id}&PayerID=QYR5Z8XDVJNXQ`
    const cb = await t.http().get(back).expect(303)
    expect(new URL(cb.headers.location).searchParams.get("status")).toBe("success")
    const detail = (await owner.get(`/api/transactions/${reference}`).expect(200)).body
    expect(detail).toMatchObject({ status: "success", amount: 150_000, currency: "USD" })
    // Reloading the return page doesn't capture again.
    await t.http().get(back).expect(303)
    expect(captures()).toHaveLength(1)
  })

  it("captures from the approval webhook when the customer never comes back", async () => {
    const { reference } = (await start().expect(201)).body
    const order = orderFor(reference)
    t.net.approvePayPal(order.id)
    const approved = {
      id: "WH-APPROVED-1",
      event_type: "CHECKOUT.ORDER.APPROVED",
      resource: { id: order.id, status: "APPROVED", purchase_units: [{ custom_id: reference, amount: order.amount }] },
    }
    await postWebhook(approved).expect(200)
    expect(captures()).toHaveLength(1)
    expect((await owner.get(`/api/transactions/${reference}`).expect(200)).body.status).toBe("success")

    // PayPal then reports the completed capture: already settled, nothing captured twice.
    const completed = {
      id: "WH-COMPLETED-1",
      event_type: "PAYMENT.CAPTURE.COMPLETED",
      resource: { id: order.captureId, status: "COMPLETED", custom_id: reference, amount: order.amount },
    }
    await postWebhook(completed).expect(200)
    expect(captures()).toHaveLength(1)
    expect((await owner.get(`/api/transactions/${reference}`).expect(200)).body.status).toBe("success")
  })

  it("leaves an unapproved order pending when the approval webhook can't be captured", async () => {
    const { reference } = (await start().expect(201)).body
    const order = orderFor(reference)
    const approved = { id: "WH-EARLY-1", event_type: "CHECKOUT.ORDER.APPROVED", resource: { id: order.id, status: "APPROVED", purchase_units: [{ custom_id: reference }] } }
    await postWebhook(approved).expect(200)
    expect((await owner.get(`/api/transactions/${reference}`).expect(200)).body.status).toBe("pending")
  })

  it("refuses webhooks PayPal doesn't confirm", async () => {
    const { reference } = (await start().expect(201)).body
    const event = { id: "WH-FORGED-1", event_type: "PAYMENT.CAPTURE.COMPLETED", resource: { id: "X", status: "COMPLETED", custom_id: reference, amount: { currency_code: "USD", value: "1500.00" } } }
    await postWebhook(event, "forged-signature").expect(401)
    expect((await owner.get(`/api/transactions/${reference}`).expect(200)).body.status).toBe("pending")
  })
})
