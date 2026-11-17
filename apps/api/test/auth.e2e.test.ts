import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createTestApp, DASHBOARD, OWNER, setupOwner, type TestApp } from "./helpers.js"

describe("auth", () => {
  let t: TestApp
  beforeEach(async () => {
    t = await createTestApp()
  })
  afterEach(async () => {
    await t.close()
  })

  it("runs first-time setup once and signs the owner in", async () => {
    expect((await t.http().get("/api/auth/state")).body).toEqual({ needsSetup: true, emailEnabled: false, setupTokenRequired: false, signupEnabled: false })
    const agent = t.agent()
    const res = await agent.post("/api/auth/setup").send(OWNER).expect(201)
    expect(res.body.user).toMatchObject({ email: OWNER.email, role: "owner", productIds: null })
    expect(res.body.user.permissions).toContain("team:write")
    const cookie = String(res.headers["set-cookie"])
    expect(cookie).toMatch(/yaropay_session=/)
    expect(cookie).toMatch(/HttpOnly/i)
    expect(cookie).toMatch(/SameSite=Lax/i)
    expect(cookie).not.toContain(OWNER.password)

    await agent.get("/api/auth/me").expect(200)
    expect((await t.http().get("/api/auth/state")).body.needsSetup).toBe(false)
    expect((await t.http().get("/api/settings").expect(401)).body.error.code).toBe("unauthenticated")
    const again = await t.http().post("/api/auth/setup").send({ ...OWNER, email: "other@example.test" }).expect(409)
    expect(again.body.error.message).toMatch(/already set up/)
    expect((await agent.get("/api/settings").expect(200)).body.companyName).toBe("Company A")
  })

  it("validates input with field errors", async () => {
    const res = await t.http().post("/api/auth/setup").send({ name: "A", email: "nope", password: "short", companyName: "" }).expect(422)
    expect(res.body.error.fields).toMatchObject({ email: expect.any(String), password: expect.any(String), name: expect.any(String) })
  })

  it("logs in, rejects wrong passwords without saying which part was wrong, and logs out", async () => {
    await setupOwner(t)
    const bad = await t.http().post("/api/auth/login").send({ email: OWNER.email, password: "wrong-password!" }).expect(401)
    const unknown = await t.http().post("/api/auth/login").send({ email: "ghost@example.test", password: "wrong-password!" }).expect(401)
    expect(bad.body.error.message).toBe(unknown.body.error.message)

    const agent = t.agent()
    await agent.post("/api/auth/login").send({ email: OWNER.email.toUpperCase(), password: OWNER.password }).expect(200)
    await agent.get("/api/auth/me").expect(200)
    await agent.post("/api/auth/logout").expect(200)
    await agent.get("/api/auth/me").expect(401)
  })

  it("tells the member about a sign-in from a new browser", async () => {
    await setupOwner(t)
    await t.agent().post("/api/auth/login").set("user-agent", "Mozilla/5.0 (Windows NT 10.0) Chrome/140.0").send({ email: OWNER.email, password: OWNER.password }).expect(200)
    const agent = t.agent()
    await agent.post("/api/auth/login").send({ email: OWNER.email, password: OWNER.password }).expect(200)
    const list = await agent.get("/api/notifications").expect(200)
    expect(list.body.rows.some((n: { type: string; body: string }) => n.type === "security.new_login" && n.body.includes("Chrome on Windows"))).toBe(true)
  })

  it("changing the password signs out every other session", async () => {
    const { agent } = await setupOwner(t)
    const other = t.agent()
    await other.post("/api/auth/login").send({ email: OWNER.email, password: OWNER.password }).expect(200)
    const wrong = await agent.post("/api/auth/password").send({ currentPassword: "not-it-at-all", newPassword: "a-brand-new-password" }).expect(401)
    expect(wrong.body.error.fields.currentPassword).toBeTruthy()
    await agent.post("/api/auth/password").send({ currentPassword: OWNER.password, newPassword: "a-brand-new-password" }).expect(200)
    await other.get("/api/auth/me").expect(401)
    await agent.get("/api/auth/me").expect(200)
    const sessions = await agent.get("/api/auth/sessions").expect(200)
    expect(sessions.body).toHaveLength(1)
    expect(sessions.body[0].current).toBe(true)
  })

  it("resets a forgotten password with a single-use emailed link", async () => {
    const { agent } = await setupOwner(t)
    await t.http().post("/api/auth/forgot").send({ email: "ghost@example.test" }).expect(200)
    await t.http().post("/api/auth/forgot").send({ email: OWNER.email }).expect(200)
    await t.jobs.runDue()
    expect(t.mailer.outbox).toHaveLength(1)
    const mail = t.mailer.outbox[0]
    expect(mail.to).toBe(OWNER.email)
    const token = new URL(/https?:\/\/\S+reset-password\?token=\S+/.exec(mail.text)![0]).searchParams.get("token")!
    expect(mail.text).toContain(`${DASHBOARD}/reset-password?token=`)

    await t.http().post("/api/auth/reset").send({ token, password: "recovered-password-1" }).expect(200)
    await agent.get("/api/auth/me").expect(401)
    await t.http().post("/api/auth/reset").send({ token, password: "recovered-password-2" }).expect(410)
    await t.http().post("/api/auth/login").send({ email: OWNER.email, password: "recovered-password-1" }).expect(200)
  })

  it("refuses state-changing requests from other origins", async () => {
    const { agent } = await setupOwner(t)
    const res = await agent.patch("/api/settings").set("origin", "https://evil.example").send({ companyName: "Pwned Co" }).expect(403)
    expect(res.body.error.code).toBe("bad_origin")
    await agent.patch("/api/settings").set("origin", DASHBOARD).send({ companyName: "Company B" }).expect(200)
  })

  it("lets a member revoke one of their sessions", async () => {
    const { agent } = await setupOwner(t)
    const other = t.agent()
    await other.post("/api/auth/login").send({ email: OWNER.email, password: OWNER.password }).expect(200)
    const sessions = (await agent.get("/api/auth/sessions").expect(200)).body as { id: string; current: boolean }[]
    const target = sessions.find((s) => !s.current)!
    await agent.delete(`/api/auth/sessions/${target.id}`).expect(200)
    await other.get("/api/auth/me").expect(401)
  })
})

describe("setup token", () => {
  const TOKEN = "0123456789abcdef0123456789abcdef"
  let t: TestApp
  beforeEach(async () => {
    t = await createTestApp({ SETUP_TOKEN: TOKEN })
  })
  afterEach(async () => {
    await t.close()
  })

  it("only lets someone holding SETUP_TOKEN create the owner account", async () => {
    expect((await t.http().get("/api/auth/state").expect(200)).body).toMatchObject({ needsSetup: true, setupTokenRequired: true })

    const missing = await t.http().post("/api/auth/setup").send(OWNER).expect(403)
    expect(missing.body.error).toMatchObject({ code: "setup_token_invalid", fields: { setupToken: expect.any(String) } })
    await t.http().post("/api/auth/setup").send({ ...OWNER, setupToken: `${TOKEN.slice(0, -1)}0` }).expect(403)

    await t.http().post("/api/auth/setup").send({ ...OWNER, setupToken: TOKEN }).expect(201)
    expect((await t.http().get("/api/auth/state").expect(200)).body).toMatchObject({ needsSetup: false, setupTokenRequired: false })
    // Once set up, the token opens nothing.
    await t.http().post("/api/auth/setup").send({ ...OWNER, email: "second@example.test", setupToken: TOKEN }).expect(409)
  })

  it("refuses to start with a token that is too short to be safe", async () => {
    await expect(createTestApp({ SETUP_TOKEN: "short" })).rejects.toThrow(/SETUP_TOKEN must be at least 16/)
  })
})
