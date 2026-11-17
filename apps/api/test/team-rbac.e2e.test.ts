import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { addMember, createProduct, createTestApp, installGateway, setupOwner, type TestApp } from "./helpers.js"

describe("team, roles and product scope", () => {
  let t: TestApp
  let owner: Awaited<ReturnType<typeof setupOwner>>["agent"]
  let shop: string
  let ledger: string
  let conId: string

  beforeEach(async () => {
    t = await createTestApp()
    owner = (await setupOwner(t)).agent
    const con = await installGateway(owner, "paystack")
    conId = con.id
    shop = (await createProduct(owner, con.id)).product.id
    ledger = (
      await createProduct(owner, con.id, {
        name: "LedgerPro",
        referencePrefix: "LDG",
        colorSlot: 2,
        webhookUrl: "https://ledger.example.test/hooks",
        successUrl: "https://ledger.example.test/ok",
        failureUrl: "https://ledger.example.test/no",
      })
    ).product.id
  })
  afterEach(async () => {
    await t.close()
  })

  it("invites by email, previews the invite and signs the new member in", async () => {
    const res = await owner.post("/api/team/invites").send({ email: "Dev@Example.test", role: "developer", productIds: [shop] }).expect(201)
    expect(res.body).toMatchObject({ emailed: false, invite: { email: "dev@example.test", role: "developer", productIds: [shop], invitedBy: "Ada Owner" } })
    expect(res.body.inviteUrl).toMatch(/^http:\/\/dash\.test\/invite\/[\w-]{20,}$/)
    await t.jobs.runDue()
    expect(t.mailer.outbox.at(-1)).toMatchObject({ to: "dev@example.test" })
    expect(t.mailer.outbox.at(-1)!.text).toContain(res.body.inviteUrl)

    const token = res.body.inviteUrl.split("/invite/")[1]
    const preview = await t.http().get(`/api/auth/invites/${token}`).expect(200)
    expect(preview.body).toMatchObject({ email: "dev@example.test", role: "developer", companyName: "Company A" })
    expect((await owner.get("/api/team/invites").expect(200)).body).toHaveLength(1)

    const dev = t.agent()
    const accepted = await dev.post(`/api/auth/invites/${token}/accept`).send({ name: "Wanjiru Dev", password: "another-long-password" }).expect(201)
    expect(accepted.body.user).toMatchObject({ role: "developer", productIds: [shop] })
    await t.http().get(`/api/auth/invites/${token}`).expect(410)
    expect((await owner.get("/api/team/invites").expect(200)).body).toHaveLength(0)
    const team = (await owner.get("/api/team").expect(200)).body as { email: string }[]
    expect(team.map((m) => m.email)).toEqual(["owner@example.test", "dev@example.test"])
    const notes = (await owner.get("/api/notifications").expect(200)).body.rows as { type: string }[]
    expect(notes.some((n) => n.type === "team.member_joined")).toBe(true)
  })

  it("a product-scoped member only ever sees their products", async () => {
    const dev = await addMember(t, owner, { email: "dev@example.test", role: "developer", productIds: [shop] })
    const products = (await dev.get("/api/products").expect(200)).body as { id: string }[]
    expect(products.map((p) => p.id)).toEqual([shop])
    await dev.get(`/api/products/${ledger}`).expect(404)
    await dev.patch(`/api/products/${ledger}`).send({ name: "Hijacked" }).expect(404)
    await dev.post(`/api/products/${ledger}/rotate`).send({ which: "apiKey" }).expect(404)
    await dev.patch(`/api/products/${shop}`).send({ name: "Shopwise 2" }).expect(200)
    await dev
      .post("/api/products")
      .send({ name: "Side", kind: "other", websiteUrl: "https://side.example.test", colorSlot: 4, referencePrefix: "SDE", gateways: [{ connectionId: conId, isDefault: true }], webhookUrl: "https://side.example.test/h", successUrl: "https://side.example.test/s", failureUrl: "https://side.example.test/f" })
      .expect(403)

    const overview = (await dev.get("/api/analytics/overview?period=30d&mode=test").expect(200)).body
    expect(overview.products.map((p: { productId: string }) => p.productId)).toEqual([shop])
    const asked = (await dev.get(`/api/analytics/overview?period=30d&product=${ledger}`).expect(200)).body
    expect(asked.products).toEqual([])
    const tx = (await dev.get(`/api/transactions?product=${ledger}`).expect(200)).body
    expect(tx.total).toBe(0)
    const unrouted = (await dev.get("/api/webhooks/events?routing=unrouted").expect(200)).body
    expect(unrouted.total).toBe(0)
  })

  it("enforces role permissions", async () => {
    const viewer = await addMember(t, owner, { email: "viewer@example.test", role: "viewer" })
    await viewer.get("/api/products").expect(200)
    await viewer.get("/api/settings").expect(200)
    const denied = await viewer.patch("/api/settings").send({ companyName: "Nope" }).expect(403)
    expect(denied.body.error).toMatchObject({ code: "forbidden" })
    await viewer.post(`/api/products/${shop}/rotate`).send({ which: "apiKey" }).expect(403)
    await viewer.post("/api/team/invites").send({ email: "x@example.test", role: "viewer" }).expect(403)
    await viewer.get("/api/transactions/export.csv").expect(403)
    await viewer.get("/api/audit").expect(403)
    await viewer.post("/api/connections").send({ gatewayId: "paystack", label: "X", mode: "test", credentials: {} }).expect(403)

    const finance = await addMember(t, owner, { email: "finance@example.test", role: "finance" })
    await finance.get("/api/transactions/export.csv").expect(200)
    await finance.patch(`/api/products/${shop}`).send({ name: "Nope" }).expect(403)
  })

  it("admins cannot hand out roles above their own; the last owner is protected", async () => {
    const admin = await addMember(t, owner, { email: "admin@example.test", role: "admin" })
    await admin.post("/api/team/invites").send({ email: "boss@example.test", role: "owner" }).expect(403)
    await admin.post("/api/team/invites").send({ email: "peer@example.test", role: "admin" }).expect(403)
    await admin.post("/api/team/invites").send({ email: "dev2@example.test", role: "developer", productIds: [ledger] }).expect(201)

    const team = (await owner.get("/api/team").expect(200)).body as { id: string; email: string }[]
    const ownerId = team.find((m) => m.email === "owner@example.test")!.id
    const adminId = team.find((m) => m.email === "admin@example.test")!.id
    await admin.delete(`/api/team/${ownerId}`).expect(403)
    await owner.delete(`/api/team/${ownerId}`).expect(403)
    await owner.patch(`/api/team/${ownerId}`).send({ role: "viewer" }).expect(403)

    // Owners always see every product, whatever scope is sent.
    const promoted = await owner.patch(`/api/team/${adminId}`).send({ role: "owner", productIds: [shop] }).expect(200)
    expect(promoted.body).toMatchObject({ role: "owner", productIds: null })
    await owner.patch(`/api/team/${adminId}`).send({ role: "viewer" }).expect(200)
  })

  it("removing a member ends their sessions", async () => {
    const dev = await addMember(t, owner, { email: "dev@example.test", role: "developer" })
    await dev.get("/api/auth/me").expect(200)
    const team = (await owner.get("/api/team").expect(200)).body as { id: string; email: string }[]
    await owner.delete(`/api/team/${team.find((m) => m.email === "dev@example.test")!.id}`).expect(200)
    await dev.get("/api/auth/me").expect(401)
    await t.http().post("/api/auth/login").send({ email: "dev@example.test", password: "another-long-password" }).expect(401)
    // Invited back later: the existing account rejoins with its own password and the new role.
    const inv = await owner.post("/api/team/invites").send({ email: "dev@example.test", role: "viewer", productIds: null }).expect(201)
    const token = String(inv.body.inviteUrl).split("/invite/")[1]
    expect((await t.http().get(`/api/auth/invites/${token}`).expect(200)).body.existingAccount).toBe(true)
    const fresh = await t.http().post(`/api/auth/invites/${token}/accept`).send({ name: "Dev Again", password: "a-brand-new-password" }).expect(409)
    expect(fresh.body.error.code).toBe("account_exists")
    await t.http().post(`/api/auth/invites/${token}/join`).send({ password: "wrong-password-here" }).expect(401)
    const back = t.agent()
    await back.post(`/api/auth/invites/${token}/join`).send({ password: "another-long-password" }).expect(201)
    expect((await back.get("/api/auth/me").expect(200)).body.user.role).toBe("viewer")
  })

  it("rejects scopes that name unknown products and revokes pending invites", async () => {
    const bad = await owner.post("/api/team/invites").send({ email: "dev@example.test", role: "developer", productIds: ["prd_nope"] }).expect(422)
    expect(bad.body.error.fields.productIds).toBeTruthy()
    const inv = await owner.post("/api/team/invites").send({ email: "dev@example.test", role: "developer" }).expect(201)
    const token = inv.body.inviteUrl.split("/invite/")[1]
    const resent = await owner.post(`/api/team/invites/${inv.body.invite.id}/resend`).expect(201)
    expect(resent.body.inviteUrl).not.toBe(inv.body.inviteUrl)
    await t.http().get(`/api/auth/invites/${token}`).expect(404)
    await owner.delete(`/api/team/invites/${inv.body.invite.id}`).expect(200)
    await t.http().get(`/api/auth/invites/${resent.body.inviteUrl.split("/invite/")[1]}`).expect(404)
  })
})
