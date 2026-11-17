import { request as httpRequest } from "node:http"
import type { AddressInfo } from "node:net"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { NotificationsService } from "../src/notifications/notifications.service.js"
import { addMember, createTestApp, OWNER, setupOwner, type TestApp } from "./helpers.js"

describe("notifications", () => {
  let t: TestApp
  let owner: Awaited<ReturnType<typeof setupOwner>>["agent"]
  let notifications: NotificationsService
  let workspaceId: string

  beforeEach(async () => {
    t = await createTestApp()
    ;({ agent: owner, workspaceId } = await setupOwner(t))
    notifications = t.app.get(NotificationsService)
  })
  afterEach(async () => {
    await t.close()
  })

  const failure = (productId: string | null = null) =>
    notifications.notify({ workspaceId, type: "delivery.failed", severity: "critical", title: "Shopwise stopped accepting events", body: "500 after 8 attempts", productId, link: "/webhooks" })

  it("fans out by permission and product scope, honouring channel preferences", async () => {
    const viewer = await addMember(t, owner, { email: "viewer@example.test", role: "viewer" })
    const scoped = await addMember(t, owner, { email: "scoped@example.test", role: "developer", productIds: [] as unknown as string[] }).catch(() => null)
    expect(scoped).toBeNull()

    const sent = await failure("prd_any")
    expect(sent).toBe(2)
    await t.jobs.runDue()
    expect(t.mailer.outbox.filter((m) => m.subject.includes("stopped accepting")).map((m) => m.to).sort()).toEqual([OWNER.email, "viewer@example.test"])

    // The viewer turns email off for this type.
    const prefs = (await viewer.get("/api/notifications/preferences").expect(200)).body as { type: string }[]
    expect(prefs.map((p) => p.type)).not.toContain("event.signature_invalid")
    await viewer.put("/api/notifications/preferences").send([{ type: "delivery.failed", inApp: true, email: false }]).expect(200)
    t.mailer.outbox.length = 0
    await failure()
    await t.jobs.runDue()
    expect(t.mailer.outbox.map((m) => m.to)).toEqual([OWNER.email])
  })

  it("lists, marks read and counts unread", async () => {
    await failure()
    await failure()
    let list = (await owner.get("/api/notifications").expect(200)).body
    expect(list).toMatchObject({ total: 2, unread: 2 })
    await owner.post(`/api/notifications/${list.rows[0].id}/read`).expect(200)
    list = (await owner.get("/api/notifications?unread=1").expect(200)).body
    expect(list).toMatchObject({ total: 1, unread: 1 })
    expect((await owner.post("/api/notifications/read-all").expect(200)).body).toEqual({ updated: 1 })
    expect((await owner.get("/api/notifications").expect(200)).body.unread).toBe(0)
    await owner.post("/api/notifications/ntf_nope/read").expect(404)
  })

  it("streams new notifications over server-sent events", async () => {
    await t.app.listen(0, "127.0.0.1")
    const port = (t.app.getHttpServer().address() as AddressInfo).port
    const login = await t.http().post("/api/auth/login").send({ email: OWNER.email, password: OWNER.password }).expect(200)
    const cookie = String(login.headers["set-cookie"]).split(";")[0]
    const received = new Promise<string>((resolve, reject) => {
      const req = httpRequest({ host: "127.0.0.1", port, path: "/api/notifications/stream", headers: { cookie, accept: "text/event-stream" } }, (res) => {
        expect(res.headers["content-type"]).toMatch(/text\/event-stream/)
        let buf = ""
        res.on("data", (chunk) => {
          buf += chunk
          if (buf.includes("event: notification")) {
            req.destroy()
            resolve(buf)
          }
        })
      })
      req.on("error", (e) => (e.message.includes("aborted") || (e as NodeJS.ErrnoException).code === "ECONNRESET" ? undefined : reject(e)))
      req.end()
      setTimeout(() => void failure(), 300)
    })
    const text = await received
    expect(text).toContain("Shopwise stopped accepting events")
  })

  it("posts alerts to the configured incoming webhook and masks the URL", async () => {
    const url = "https://hooks.slack.test/services/T000/B000/secretsecret"
    const saved = await owner.patch("/api/settings").send({ alertsWebhookUrl: url }).expect(200)
    expect(saved.body.alertsWebhookUrl).toBe("https://hooks.slack.test/••••cret")
    // Sending the masked value back keeps the stored URL.
    await owner.patch("/api/settings").send({ alertsWebhookUrl: saved.body.alertsWebhookUrl, companyName: "Company B" }).expect(200)
    expect((await owner.post("/api/settings/alerts/test").expect(200)).body.ok).toBe(true)
    await failure()
    await t.jobs.runDue()
    const posts = t.net.sentTo(url)
    expect(posts).toHaveLength(2)
    expect(JSON.parse(posts[1].body).text).toContain("Shopwise stopped accepting events")
    await owner.patch("/api/settings").send({ alertsWebhookUrl: "" }).expect(200)
    expect((await owner.get("/api/settings").expect(200)).body.alertsWebhookUrl).toBeNull()
  })

  it("keeps install-wide events away from product-scoped members", async () => {
    const con = await owner.post("/api/connections").send({ gatewayId: "paystack", label: "Sandbox", mode: "test", credentials: { publicKey: "pk_test_1234567890abcdefghij", secretKey: "sk_test_1234567890abcdefghij" } }).expect(201)
    const product = await owner
      .post("/api/products")
      .send({ name: "Shop", kind: "website", websiteUrl: "https://shop.example.test", colorSlot: 1, referencePrefix: "SHP", gateways: [{ connectionId: con.body.id, isDefault: true }], webhookUrl: "https://shop.example.test/h", successUrl: "https://shop.example.test/s", failureUrl: "https://shop.example.test/f" })
      .expect(201)
    const scoped = await addMember(t, owner, { email: "scoped@example.test", role: "developer", productIds: [product.body.product.id] })
    expect(await notifications.notify({ workspaceId, type: "event.unrouted", title: "Unrouted", body: "x" })).toBe(1)
    expect((await scoped.get("/api/notifications").expect(200)).body.total).toBe(0) // not even their own "joined" notice
    const types = ((await scoped.get("/api/notifications/preferences").expect(200)).body as { type: string }[]).map((p) => p.type)
    expect(types).not.toContain("event.unrouted")
    expect(await failure(product.body.product.id)).toBe(2)
  })

  it("collapses bursts with a throttle key", async () => {
    const send = () => notifications.notify({ workspaceId, type: "event.unrouted", title: "Unrouted", body: "x", throttleKey: "con_1" })
    expect(await send()).toBe(1)
    expect(await send()).toBe(0)
  })
})
