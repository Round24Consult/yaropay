import { createHmac } from "node:crypto"
import { sql } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { hashPassword } from "../src/auth/password.js"
import { newId } from "../src/common/crypto.js"
import { rowsOf } from "../src/database/db.js"
import { users } from "../src/database/schema.js"
import { WorkspacesService } from "../src/workspaces/workspaces.service.js"
import { createProduct, createTestApp, installGateway, OWNER, PAYSTACK_TEST, setupOwner, type TestApp } from "./helpers.js"

/**
 * Two companies on one install. Workspace B's owner calls every dashboard route with workspace A's
 * IDs and must never see, change or learn about A's data. New routes must be added to ROUTES below,
 * or the coverage check at the end fails.
 */

type Agent = ReturnType<TestApp["agent"]>

interface A {
  workspaceId: string
  ownerId: string
  connectionId: string
  productId: string
  productName: string
  transactionId: string
  reference: string
  deliveryId: string
  inviteId: string
  notificationId: string
  testApiKey: string
}

// Every route the API exposes, with how this suite checks it ("public" routes are reached without a
// session and resolve their workspace from the product, connection or invite they name).
const ROUTES: Record<string, "checked" | "public" | "self"> = {
  "GET /health": "public",
  "GET /api/auth/state": "public",
  "POST /api/auth/setup": "public",
  "POST /api/auth/login": "public",
  "POST /api/auth/logout": "self",
  "GET /api/auth/me": "checked",
  "GET /api/entitlements": "self",
  "PATCH /api/auth/me": "self",
  "POST /api/auth/password": "self",
  "GET /api/auth/sessions": "self",
  "DELETE /api/auth/sessions/:id": "self",
  // Two-step sign-in belongs to the account, not to a workspace.
  "POST /api/auth/mfa/verify": "self",
  "GET /api/auth/mfa": "self",
  "POST /api/auth/mfa/setup": "self",
  "POST /api/auth/mfa/enable": "self",
  "POST /api/auth/mfa/disable": "self",
  "POST /api/auth/mfa/recovery-codes": "self",
  "POST /api/auth/reauth": "self",
  "POST /api/auth/support/end": "self",
  "POST /api/auth/forgot": "public",
  "POST /api/auth/reset": "public",
  "GET /api/auth/invites/:token": "public",
  "POST /api/auth/invites/:token/accept": "public",
  "POST /api/auth/invites/:token/join": "public",
  "POST /api/auth/workspace": "checked",
  "GET /api/team": "checked",
  "GET /api/team/invites": "checked",
  "POST /api/team/invites": "checked",
  "POST /api/team/invites/:id/resend": "checked",
  "DELETE /api/team/invites/:id": "checked",
  "PATCH /api/team/:id": "checked",
  "DELETE /api/team/:id": "checked",
  "GET /api/settings": "checked",
  "PATCH /api/settings": "checked",
  "POST /api/settings/alerts/test": "checked",
  "GET /api/audit": "checked",
  "GET /api/notifications": "checked",
  "GET /api/notifications/stream": "self",
  "GET /api/notifications/preferences": "self",
  "PUT /api/notifications/preferences": "self",
  "POST /api/notifications/read-all": "checked",
  "POST /api/notifications/:id/read": "checked",
  "GET /api/gateways": "checked",
  "GET /api/connections": "checked",
  "POST /api/connections": "checked",
  "POST /api/connections/test": "self",
  "GET /api/connections/:id": "checked",
  "PATCH /api/connections/:id": "checked",
  "DELETE /api/connections/:id": "checked",
  "GET /api/products": "checked",
  "POST /api/products": "checked",
  "GET /api/products/:id": "checked",
  "PATCH /api/products/:id": "checked",
  "DELETE /api/products/:id": "checked",
  "POST /api/products/:id/rotate": "checked",
  "POST /api/products/:id/test-webhook": "checked",
  "GET /api/transactions": "checked",
  "GET /api/transactions/export.csv": "checked",
  "GET /api/transactions/:id": "checked",
  "GET /api/webhooks/events": "checked",
  "GET /api/webhooks/deliveries": "checked",
  "POST /api/webhooks/deliveries/:id/replay": "checked",
  "GET /api/analytics/overview": "checked",
  "GET /api/onboarding": "checked",
  "POST /api/onboarding/dismiss": "self",
  "POST /api/onboarding/restore": "self",
  "POST /api/sample-data": "checked",
  "DELETE /api/sample-data": "checked",
  "POST /v1/products/:productId/payments": "checked",
  "GET /v1/products/:productId/payments/:reference": "checked",
  "GET /v1/callback/:a/:b": "public",
  "POST /v1/webhooks/:gateway/:connectionId": "checked",
}

describe("workspace isolation", () => {
  let t: TestApp
  let a: A
  let ownerA: Agent
  let ownerB: Agent
  let workspaceB: string
  let bTestKey: string

  /** Fails if a response mentions anything that belongs to workspace A. */
  const leaks = (body: unknown) => {
    const text = JSON.stringify(body)
    return [a.workspaceId, a.productId, a.productName, a.connectionId, a.transactionId, a.reference, a.deliveryId, a.inviteId, a.notificationId, OWNER.email, "alpha-customer@example.test", "alpha-hire@example.test"]
      .filter((v) => text.includes(v))
  }

  beforeAll(async () => {
    t = await createTestApp()

    // Workspace A, with a gateway account, a product, a payment, a delivery, an invite and a notification.
    const setup = await setupOwner(t)
    ownerA = setup.agent
    const con = await installGateway(ownerA, "paystack", "Company A account")
    const product = await createProduct(ownerA, con.id, { name: "Alpha Store", referencePrefix: "ALP" })
    const pay = await t
      .http()
      .post(`/v1/products/${product.product.id}/payments`)
      .set("authorization", `Bearer ${product.testApiKey}`)
      .send({ amount: 5_000, currency: "NGN", email: "alpha-customer@example.test" })
      .expect(201)
    const delivery = await ownerA.post(`/api/products/${product.product.id}/test-webhook`).send({ mode: "test" }).expect(200)
    const invite = await ownerA.post("/api/team/invites").send({ email: "alpha-hire@example.test", role: "viewer", productIds: null }).expect(201)
    const unrouted = JSON.stringify({ event: "charge.success", data: { id: 5, reference: "ZZZ_NOBODY", amount: 100, currency: "NGN", metadata: {} } })
    await t
      .http()
      .post(`/v1/webhooks/paystack/${con.id}`)
      .set("content-type", "application/json")
      .set("x-paystack-signature", createHmac("sha512", PAYSTACK_TEST.secretKey).update(unrouted).digest("hex"))
      .send(unrouted)
      .expect(200)
    const notes = (await ownerA.get("/api/notifications").expect(200)).body as { rows: { id: string }[] }
    expect(notes.rows.length).toBeGreaterThan(0)
    a = {
      workspaceId: setup.workspaceId,
      ownerId: setup.user.id,
      connectionId: con.id,
      productId: product.product.id,
      productName: "Alpha Store",
      transactionId: pay.body.id,
      reference: pay.body.reference,
      deliveryId: delivery.body.id,
      inviteId: invite.body.invite.id,
      notificationId: notes.rows[0].id,
      testApiKey: product.testApiKey,
    }

    // Workspace B: a second company with its own owner and data.
    const workspaces = t.app.get(WorkspacesService)
    const ws = await workspaces.create({ name: "Company B" })
    workspaceB = ws.id
    const [userB] = await t.db
      .insert(users)
      .values({ id: newId("usr"), email: "bea@example.test", name: "Bea Owner", passwordHash: await hashPassword("bea-long-password", "fast") })
      .returning()
    await workspaces.addMember({ workspaceId: ws.id, userId: userB.id, role: "owner", productIds: null })
    ownerB = t.agent()
    await ownerB.post("/api/auth/login").send({ email: "bea@example.test", password: "bea-long-password" }).expect(200)
    const conB = await installGateway(ownerB, "paystack", "Company B account")
    // Same reference prefix as A's product: prefixes are unique per workspace, not per install.
    const productB = await createProduct(ownerB, conB.id, { name: "Beta Store", referencePrefix: "ALP", colorSlot: 2 })
    await createProduct(ownerB, conB.id, { name: "Beta Two", referencePrefix: "BET", colorSlot: 3 })
    bTestKey = productB.testApiKey
  })

  afterAll(async () => {
    await t.close()
  })

  it("B's session works in B's workspace only", async () => {
    const me = (await ownerB.get("/api/auth/me").expect(200)).body.user
    expect(me.workspace.id).toBe(workspaceB)
    expect(me.workspaces.map((w: { id: string }) => w.id)).toEqual([workspaceB])
    await ownerB.post("/api/auth/workspace").send({ workspaceId: a.workspaceId }).expect(404)
  })

  it("lists and reports never include another workspace's data", async () => {
    const reads = [
      "/api/products",
      "/api/connections",
      "/api/gateways",
      "/api/transactions?mode=test",
      "/api/transactions?mode=live",
      "/api/webhooks/events?mode=test",
      "/api/webhooks/deliveries?mode=test",
      "/api/team",
      "/api/team/invites",
      "/api/audit",
      "/api/notifications",
      "/api/analytics/overview?mode=test",
      "/api/onboarding",
      "/api/settings",
      "/api/auth/me",
    ]
    for (const path of reads) {
      const res = await ownerB.get(path).expect(200)
      expect(leaks(res.body), path).toEqual([])
    }
    const csv = await ownerB.get("/api/transactions/export.csv?mode=test").expect(200)
    expect(leaks(csv.text)).toEqual([])
    expect((await ownerB.get("/api/settings").expect(200)).body.companyName).toBe("Company B")
  })

  it("detail and change routes answer 404 for another workspace's IDs", async () => {
    const notFound: [string, string, unknown?][] = [
      ["get", `/api/products/${a.productId}`],
      ["patch", `/api/products/${a.productId}`, { name: "Hijacked" }],
      ["delete", `/api/products/${a.productId}`],
      ["post", `/api/products/${a.productId}/rotate`, { which: "apiKey" }],
      ["post", `/api/products/${a.productId}/test-webhook`, { mode: "test" }],
      ["get", `/api/connections/${a.connectionId}`],
      ["patch", `/api/connections/${a.connectionId}`, { label: "Hijacked" }],
      ["delete", `/api/connections/${a.connectionId}?force=1`],
      ["get", `/api/transactions/${a.transactionId}`],
      ["get", `/api/transactions/${a.reference}`],
      ["post", `/api/webhooks/deliveries/${a.deliveryId}/replay`],
      ["patch", `/api/team/${a.ownerId}`, { role: "viewer" }],
      ["delete", `/api/team/${a.ownerId}`],
      ["post", `/api/team/invites/${a.inviteId}/resend`],
      ["delete", `/api/team/invites/${a.inviteId}`],
      ["post", `/api/notifications/${a.notificationId}/read`],
    ]
    for (const [method, path, body] of notFound) {
      const req = (ownerB as unknown as Record<string, (p: string) => { send: (b: unknown) => Promise<{ status: number }> }>)[method](path)
      const res = await req.send(body ?? {})
      expect(res.status, `${method.toUpperCase()} ${path}`).toBe(404)
    }
  })

  it("B can't attach A's gateway account or scope a member to A's product", async () => {
    const attach = await ownerB
      .post("/api/products")
      .send({
        name: "Borrower",
        kind: "website",
        websiteUrl: "https://b.example.test",
        colorSlot: 3,
        referencePrefix: "BRW",
        gateways: [{ connectionId: a.connectionId, isDefault: true }],
        webhookUrl: "https://b.example.test/hooks",
        successUrl: "https://b.example.test/ok",
        failureUrl: "https://b.example.test/fail",
      })
      .expect(422)
    expect(attach.body.error.fields.gateways).toBeTruthy()
    const scoped = await ownerB.post("/api/team/invites").send({ email: "x@example.test", role: "viewer", productIds: [a.productId] }).expect(422)
    expect(scoped.body.error.fields.productIds).toBeTruthy()
  })

  it("mutations in B leave A untouched", async () => {
    await ownerB.post("/api/notifications/read-all").expect(200)
    await ownerB.patch("/api/settings").send({ companyName: "Company B Ltd", alertsWebhookUrl: "https://hooks.example.test/b" }).expect(200)
    await ownerB.post("/api/settings/alerts/test").expect(200)
    expect((await ownerA.get("/api/settings").expect(200)).body).toMatchObject({ companyName: OWNER.companyName, alertsWebhookUrl: null })
    const unread = (await ownerA.get("/api/notifications").expect(200)).body.unread
    expect(unread).toBeGreaterThan(0)
    // Sample data is loaded into B only, and B's removal can't touch A.
    await ownerB.delete("/api/sample-data").expect(200)
    const aProducts = (await ownerA.get("/api/products").expect(200)).body as { id: string }[]
    expect(aProducts.map((p) => p.id)).toEqual([a.productId])
    // B already has a product, so B can't load sample data either; A's data isn't counted for B.
    expect((await ownerB.post("/api/sample-data").expect(409)).body.error.message).toMatch(/empty install/)
  })

  it("public endpoints stay inside the workspace the key, account or product belongs to", async () => {
    // B's key can't start or read payments for A's product.
    await t.http().post(`/v1/products/${a.productId}/payments`).set("authorization", `Bearer ${bTestKey}`).send({ amount: 100, currency: "NGN", email: "x@example.test" }).expect(401)
    await t.http().get(`/v1/products/${a.productId}/payments/${a.reference}`).set("authorization", `Bearer ${bTestKey}`).expect(401)
    // A webhook on A's account carrying a prefix only B uses isn't routed to B's product.
    const body = JSON.stringify({ event: "charge.success", data: { id: 9, reference: "BET_FROMA0001", amount: 100, currency: "NGN", metadata: {} } })
    const res = await t
      .http()
      .post(`/v1/webhooks/paystack/${a.connectionId}`)
      .set("content-type", "application/json")
      .set("x-paystack-signature", createHmac("sha512", PAYSTACK_TEST.secretKey).update(body).digest("hex"))
      .send(body)
      .expect(200)
    expect(res.body).toMatchObject({ received: true, routed: false })
    const bEvents = (await ownerB.get("/api/webhooks/events?mode=test").expect(200)).body as { rows: { reference: string | null }[] }
    expect(bEvents.rows.some((e) => e.reference === "BET_FROMA0001")).toBe(false)
    // Even B's product metadata on A's account routes nowhere outside A.
    const bProducts = (await ownerB.get("/api/products").expect(200)).body as { id: string }[]
    const meta = JSON.stringify({ event: "charge.success", data: { id: 10, reference: "XYZ_META0001", amount: 100, currency: "NGN", metadata: { yaropay_product: bProducts[0].id } } })
    const res2 = await t
      .http()
      .post(`/v1/webhooks/paystack/${a.connectionId}`)
      .set("content-type", "application/json")
      .set("x-paystack-signature", createHmac("sha512", PAYSTACK_TEST.secretKey).update(meta).digest("hex"))
      .send(meta)
      .expect(200)
    expect(res2.body).toMatchObject({ received: true, routed: false })
  })

  it("a member of both workspaces switches between them, and a stale tab is refused", async () => {
    // A invites B's owner as a viewer; Bea joins with the account she already has.
    const inv = await ownerA.post("/api/team/invites").send({ email: "bea@example.test", role: "viewer", productIds: null }).expect(201)
    const token = String(inv.body.inviteUrl).split("/invite/")[1]
    const bea = t.agent()
    const joined = await bea.post(`/api/auth/invites/${token}/join`).send({ password: "bea-long-password" }).expect(201)
    expect(joined.body.user.workspace.id).toBe(a.workspaceId)
    expect(joined.body.user.role).toBe("viewer")
    expect(joined.body.user.workspaces.map((w: { id: string }) => w.id).sort()).toEqual([a.workspaceId, workspaceB].sort())

    // In A she sees A's product as a viewer and can't change anything.
    expect(((await bea.get("/api/products").expect(200)).body as { id: string }[]).map((p) => p.id)).toEqual([a.productId])
    await bea.patch(`/api/products/${a.productId}`).send({ name: "Nope" }).expect(403)

    // Switching moves the whole session; a tab still showing A gets 409 instead of acting on B.
    const switched = await bea.post("/api/auth/workspace").set("x-workspace-id", a.workspaceId).send({ workspaceId: workspaceB }).expect(200)
    expect(switched.body.user).toMatchObject({ workspace: { id: workspaceB, name: "Company B Ltd" }, role: "owner" })
    const stale = await bea.get("/api/products").set("x-workspace-id", a.workspaceId).expect(409)
    expect(stale.body.error.code).toBe("workspace_changed")
    const inB = (await bea.get("/api/products").set("x-workspace-id", workspaceB).expect(200)).body as { name: string }[]
    expect(inB.map((p) => p.name).sort()).toEqual(["Beta Store", "Beta Two"])

    // Removed from A: her sessions there end, but her account and workspace B carry on.
    await bea.post("/api/auth/workspace").send({ workspaceId: a.workspaceId }).expect(200)
    const team = (await ownerA.get("/api/team").expect(200)).body as { id: string; email: string }[]
    await ownerA.delete(`/api/team/${team.find((m) => m.email === "bea@example.test")!.id}`).expect(200)
    await bea.get("/api/auth/me").expect(401)
    const again = t.agent()
    const login = await again.post("/api/auth/login").send({ email: "bea@example.test", password: "bea-long-password" }).expect(200)
    expect(login.body.user.workspaces.map((w: { id: string }) => w.id)).toEqual([workspaceB])
  })

  it("covers every route the API exposes", () => {
    const instance = t.app.getHttpAdapter().getInstance() as { router?: { stack: unknown[] }; _router?: { stack: unknown[] } }
    const stack = (instance.router ?? instance._router)!.stack as { route?: { path: string; methods: Record<string, boolean> } }[]
    const found = stack
      .filter((l) => l.route)
      .flatMap((l) => Object.keys(l.route!.methods).filter((m) => m !== "_all").map((m) => `${m.toUpperCase()} ${l.route!.path}`))
    const unknown = found.filter((r) => !(r in ROUTES))
    expect(unknown, "new routes need an isolation check").toEqual([])
    const gone = Object.keys(ROUTES).filter((r) => !found.includes(r))
    expect(gone, "routes listed here no longer exist").toEqual([])
  })

  it("every row must name its workspace: no workspace_id column has a default to fall back on", async () => {
    const columns = rowsOf<{ table_name: string; column_default: string | null; is_nullable: string }>(
      await t.db.execute(sql`
        select table_name, column_default, is_nullable from information_schema.columns
        where table_schema = current_schema() and column_name = 'workspace_id'
          -- Not company data: a session's current workspace, and the platform's own audit log (which
          -- notes the company it concerns and must outlive it).
          and table_name not in ('sessions', 'platform_audit_log')
      `),
    )
    expect(columns.length).toBeGreaterThanOrEqual(9)
    expect(columns.filter((c) => c.column_default !== null).map((c) => c.table_name), "workspace_id defaults").toEqual([])
    expect(columns.filter((c) => c.is_nullable !== "NO").map((c) => c.table_name), "nullable workspace_id").toEqual([])
  })
})
