import { createHmac } from "node:crypto"
import { eq, sql } from "drizzle-orm"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { rowsOf } from "../src/database/db.js"
import { webhookDeliveries } from "../src/database/schema.js"
import { isPublicBaseUrl } from "../src/onboarding/onboarding.service.js"
import { addMember, createProduct, createTestApp, installGateway, PAYSTACK_TEST, setupOwner, type TestApp } from "./helpers.js"

type Status = {
  steps: { id: string; done: boolean }[]
  completed: number
  total: number
  dismissed: boolean
  sampleData: { present: boolean; canLoad: boolean }
  connectionId: string | null
  productId: string | null
}

const done = (s: Status) => Object.fromEntries(s.steps.map((x) => [x.id, x.done]))

describe("onboarding and sample data", () => {
  let t: TestApp
  let owner: Awaited<ReturnType<typeof setupOwner>>["agent"]
  const status = async (agent = owner) => (await agent.get("/api/onboarding").expect(200)).body as Status

  beforeEach(async () => {
    t = await createTestApp()
    owner = (await setupOwner(t)).agent
  })
  afterEach(async () => {
    await t.close()
  })

  it("tracks setup from real data only, and removes sample data without touching it", async () => {
    await owner.patch("/api/settings").send({ baseUrl: "http://localhost:3000" }).expect(200)
    let s = await status()
    expect(s).toMatchObject({ completed: 0, total: 6, dismissed: false, sampleData: { present: false, canLoad: true }, connectionId: null, productId: null })
    expect(Object.values(done(s)).every((d) => !d)).toBe(true)

    // Only members who can change settings load sample data, and only into an empty install.
    const dev = await addMember(t, owner, { email: "dev@example.test", role: "developer" })
    await dev.post("/api/sample-data").expect(403)
    s = (await owner.post("/api/sample-data").expect(201)).body
    expect(s.sampleData).toEqual({ present: true, canLoad: false })
    expect(done(s)).toMatchObject({ gateway: false, product: false, test_payment: false, product_webhook: false, team: true })
    const listed = (await owner.get("/api/products").expect(200)).body as { id: string; sample: boolean }[]
    expect(listed).toHaveLength(3)
    expect(listed.every((p) => p.sample)).toBe(true)
    expect((await owner.post("/api/sample-data").expect(409)).body.error.message).toMatch(/empty install/)

    // A sample delivery that falls due is left alone by the worker: its host is made up.
    await t.db.update(webhookDeliveries).set({ nextRetryAt: new Date(Date.now() - 60_000) }).where(eq(webhookDeliveries.state, "retrying"))
    expect(await t.deliveries.runDue()).toBe(0)

    // Real products can't borrow the sample gateway accounts.
    const con = await installGateway(owner, "paystack", "Bookly test")
    const borrowed = await owner
      .post("/api/products")
      .send({
        name: "Mine",
        kind: "website",
        websiteUrl: "https://mine.example.test",
        colorSlot: 4,
        referencePrefix: "MIN",
        gateways: [{ connectionId: "con_ps_main", isDefault: true }],
        webhookUrl: "https://mine.example.test/hooks",
        successUrl: "https://mine.example.test/ok",
        failureUrl: "https://mine.example.test/fail",
      })
      .expect(422)
    expect(borrowed.body.error.fields.gateways).toMatch(/Sample gateway accounts/)

    const product = await createProduct(owner, con.id, { name: "Bookly", referencePrefix: "BKL", colorSlot: 5 })
    s = await status()
    expect(done(s)).toMatchObject({ base_url: false, gateway: true, gateway_webhook: false, product: true })
    expect(s.connectionId).toBe(con.id)
    expect(s.productId).toBe(product.product.id)

    await owner.patch("/api/settings").send({ baseUrl: "https://pay.example.test" }).expect(200)

    // The gateway's first correctly signed event, even an unrouted one.
    const body = JSON.stringify({ event: "charge.success", data: { id: 7, reference: "T-OUTSIDE-1", amount: 5000, currency: "NGN", metadata: {} } })
    await t
      .http()
      .post(`/v1/webhooks/paystack/${con.id}`)
      .set("content-type", "application/json")
      .set("x-paystack-signature", createHmac("sha512", PAYSTACK_TEST.secretKey).update(body).digest("hex"))
      .send(body)
      .expect(200)

    // A successful test payment, forwarded to the product.
    const pay = await t
      .http()
      .post(`/v1/products/${product.product.id}/payments`)
      .set("authorization", `Bearer ${product.testApiKey}`)
      .send({ amount: 250_000, currency: "NGN", email: "kemi@example.test" })
      .expect(201)
    t.net.setStatus(pay.body.reference, "success")
    await t.http().get(`/v1/callback/${product.product.id}/paystack?reference=${pay.body.reference}`).expect(303)
    expect(await t.deliveries.runDue()).toBe(1)

    s = await status()
    expect(s.completed).toBe(6)
    expect(done(s)).toMatchObject({ base_url: true, gateway_webhook: true, test_payment: true, product_webhook: true })

    const removed = (await owner.delete("/api/sample-data").expect(200)).body
    expect(removed).toMatchObject({ products: 3, connections: 3 })
    expect(removed.transactions).toBeGreaterThan(100)
    const left = (await owner.get("/api/products").expect(200)).body as { id: string }[]
    expect(left.map((p) => p.id)).toEqual([product.product.id])
    expect(((await owner.get("/api/connections").expect(200)).body as { id: string }[]).map((c) => c.id)).toEqual([con.id])
    expect((await owner.get("/api/transactions?mode=test").expect(200)).body.total).toBe(1)
    expect((await owner.get("/api/transactions?mode=live").expect(200)).body.total).toBe(0)
    const audit = (await owner.get("/api/audit").expect(200)).body as { action: string; actorName: string }[]
    expect(audit[0]).toMatchObject({ action: "Removed sample data" })
    expect(audit.some((a) => a.actorName === "Tunde Bello")).toBe(false)
    s = await status()
    expect(s.sampleData).toEqual({ present: false, canLoad: false })
    expect(s.completed).toBe(6)
    const [{ n }] = rowsOf<{ n: number }>(await t.db.execute(sql`select count(*)::int as n from webhook_events where connection_id like 'con_%_main'`))
    expect(n).toBe(0)
  })

  it("hides the guide per member and only links to products they can see", async () => {
    const con = await installGateway(owner, "paystack")
    await createProduct(owner, con.id)
    const second = await createProduct(owner, con.id, { name: "LedgerPro", referencePrefix: "LDG", colorSlot: 2 })
    const scoped = await addMember(t, owner, { email: "fin@example.test", role: "finance", productIds: [second.product.id] })

    await owner.post("/api/onboarding/dismiss").expect(204)
    expect((await status()).dismissed).toBe(true)
    const theirs = await status(scoped)
    expect(theirs.dismissed).toBe(false)
    expect(theirs.productId).toBe(second.product.id)
    await scoped.post("/api/sample-data").expect(403)
    await scoped.delete("/api/sample-data").expect(403)

    await owner.post("/api/onboarding/restore").expect(204)
    expect((await status()).dismissed).toBe(false)
  })

  it("only counts https URLs on public hosts as a reachable base URL", () => {
    expect(isPublicBaseUrl("https://pay.company-a.com")).toBe(true)
    expect(isPublicBaseUrl("https://abc123.ngrok-free.app")).toBe(true)
    expect(isPublicBaseUrl("https://203.0.113.9")).toBe(true)
    for (const url of ["http://pay.company-a.com", "https://localhost:3000", "https://app.localhost", "https://10.0.0.4", "https://[::1]", "https://intranet", "not a url"]) {
      expect(isPublicBaseUrl(url), url).toBe(false)
    }
  })
})
