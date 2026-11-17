import { randomBytes } from "node:crypto"
import { eq } from "drizzle-orm"
import { afterEach, describe, expect, it } from "vitest"
import { hashPassword } from "../src/auth/password.js"
import { decrypt, encrypt, newId } from "../src/common/crypto.js"
import { EncryptionService } from "../src/common/encryption.service.js"
import { reencryptAll } from "../src/common/key-rotation.js"
import { connections, products, users, webhookDeliveries } from "../src/database/schema.js"
import { WorkspacesService } from "../src/workspaces/workspaces.service.js"
import { createProduct, createTestApp, installGateway, setupOwner, type TestApp } from "./helpers.js"

/** A second company with its own owner, gateway account and product. */
async function companyB(t: TestApp) {
  const ws = await t.app.get(WorkspacesService).create({ name: "Company B" })
  const [u] = await t.db
    .insert(users)
    .values({ id: newId("usr"), email: "bea@example.test", name: "Bea", passwordHash: await hashPassword("bea-long-password", "fast") })
    .returning()
  await t.app.get(WorkspacesService).addMember({ workspaceId: ws.id, userId: u.id, role: "owner", productIds: null })
  const owner = t.agent()
  await owner.post("/api/auth/login").send({ email: "bea@example.test", password: "bea-long-password" }).expect(200)
  const con = await installGateway(owner, "paystack", "B account")
  const product = await createProduct(owner, con.id, { name: "Beta Store", referencePrefix: "BET" })
  return { workspaceId: ws.id, product }
}

describe("operations", () => {
  let t: TestApp
  afterEach(async () => {
    await t.close()
  })

  it("takes turns between companies when deliveries pile up", async () => {
    t = await createTestApp()
    const { agent, workspaceId: a } = await setupOwner(t)
    const conA = await installGateway(agent, "paystack")
    const productA = await createProduct(agent, conA.id)
    const b = await companyB(t)
    const due = (workspaceId: string, productId: string, i: number) => ({
      id: newId("dlv"),
      workspaceId,
      productId,
      mode: "test",
      url: "https://shop.example.test/hooks/yaropay",
      eventType: "payment.succeeded",
      payload: { i },
      state: "pending",
      nextRetryAt: new Date(Date.now() - (100 - i) * 1000),
    })
    // Company A's twelve are all older than company B's two.
    await t.db.insert(webhookDeliveries).values(Array.from({ length: 12 }, (_, i) => due(a, productA.product.id, i)))
    await t.db.insert(webhookDeliveries).values([due(b.workspaceId, b.product.product.id, 50), due(b.workspaceId, b.product.product.id, 51)])

    expect(await t.deliveries.runDue(4)).toBe(4)
    const delivered = await t.db.select().from(webhookDeliveries).where(eq(webhookDeliveries.state, "delivered"))
    expect(delivered.filter((d) => d.workspaceId === b.workspaceId)).toHaveLength(2)
    expect(delivered.filter((d) => d.workspaceId === a)).toHaveLength(2)
  })

  it("gives each company its own product API budget", async () => {
    t = await createTestApp({ RATE_LIMIT: "true", V1_RATE_LIMIT_PER_MINUTE: "3" })
    const { agent } = await setupOwner(t)
    const con = await installGateway(agent, "paystack")
    const product = await createProduct(agent, con.id)
    const b = await companyB(t)
    const pay = (p: { product: { id: string }; testApiKey: string }) =>
      t.http().post(`/v1/products/${p.product.id}/payments`).set("authorization", `Bearer ${p.testApiKey}`).send({ amount: 5000, currency: "NGN", email: "c@example.test" })
    for (let i = 0; i < 3; i++) await pay(product).expect(201)
    const limited = await pay(product).expect(429)
    expect(limited.body.error.code).toBe("rate_limited")
    expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0)
    // Another company is unaffected.
    await pay(b.product).expect(201)
  })

  it("rotates the encryption key: reads old values, rewrites them with the new key", async () => {
    const oldKey = randomBytes(32)
    const newKey = randomBytes(32)
    t = await createTestApp({ YAROPAY_ENCRYPTION_KEY: newKey.toString("base64"), YAROPAY_ENCRYPTION_KEY_PREVIOUS: oldKey.toString("base64") })
    const { agent } = await setupOwner(t)
    const con = await installGateway(agent, "paystack")
    const product = await createProduct(agent, con.id)

    // Pretend these were saved before the rotation, under the old key.
    const [c] = await t.db.select().from(connections).where(eq(connections.id, con.id))
    await t.db.update(connections).set({ credentialsEnc: encrypt(oldKey, decrypt(newKey, c.credentialsEnc)) }).where(eq(connections.id, con.id))
    const [p] = await t.db.select().from(products).where(eq(products.id, product.product.id))
    const secret = decrypt(newKey, p.signingSecretEnc)
    await t.db.update(products).set({ signingSecretEnc: encrypt(oldKey, secret) }).where(eq(products.id, p.id))

    // The app still reads them (a payment needs the gateway credentials).
    expect(t.app.get(EncryptionService).decrypt(encrypt(oldKey, "hello"))).toBe("hello")
    await t
      .http()
      .post(`/v1/products/${product.product.id}/payments`)
      .set("authorization", `Bearer ${product.testApiKey}`)
      .send({ amount: 5000, currency: "NGN", email: "c@example.test" })
      .expect(201)

    // Something no configured key can read stays as it is.
    const stranger = encrypt(randomBytes(32), "unknown")
    await t.db.update(products).set({ signingSecretEnc: stranger }).where(eq(products.id, p.id))
    let results = await reencryptAll(t.db, t.config)
    expect(results.find((r) => r.table === "products")).toMatchObject({ rewritten: 0, unreadable: 1 })
    expect(results.find((r) => r.table === "connections")).toMatchObject({ rewritten: 1, unreadable: 0 })
    expect((await t.db.select().from(products).where(eq(products.id, p.id)))[0].signingSecretEnc).toBe(stranger)

    // Put the real one back and rotate again: everything now reads with the new key alone.
    await t.db.update(products).set({ signingSecretEnc: encrypt(oldKey, secret) }).where(eq(products.id, p.id))
    results = await reencryptAll(t.db, t.config)
    expect(results.reduce((n, r) => n + r.unreadable, 0)).toBe(0)
    const [after] = await t.db.select().from(products).where(eq(products.id, p.id))
    expect(decrypt(newKey, after.signingSecretEnc)).toBe(secret)
    const [conAfter] = await t.db.select().from(connections).where(eq(connections.id, con.id))
    expect(() => decrypt(newKey, conAfter.credentialsEnc)).not.toThrow()
  })
})
