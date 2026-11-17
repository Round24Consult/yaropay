import { eq } from "drizzle-orm"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { resetTwoStep } from "../src/auth/account-repairs.js"
import { base32Decode, totpCode, totpStep } from "../src/auth/totp.js"
import { TRUSTED_COOKIE } from "../src/auth/trusted-browsers.js"
import { auditLog, sessions, trustedBrowsers, users } from "../src/database/schema.js"
import { addMember, createTestApp, OWNER, setupOwner, type TestApp } from "./helpers.js"

const codeFor = (secret: string, offset = 0) => totpCode(base32Decode(secret), totpStep() + offset)
const DEV = { email: "dev@example.test", password: "another-long-password" }

type Agent = ReturnType<TestApp["agent"]>

/** The Set-Cookie line for the trusted-browser cookie, if the response set or cleared it. */
const trustedSetCookie = (res: { headers: Record<string, unknown> }) =>
  ([res.headers["set-cookie"]].flat().filter(Boolean) as string[]).find((c) => c.startsWith(`${TRUSTED_COOKIE}=`))
const tokenOf = (cookie: string | undefined) => /^[^=]+=([^;]*)/.exec(cookie ?? "")?.[1] ?? ""
const clears = (cookie: string | undefined) => Boolean(cookie && (/Max-Age=0/i.test(cookie) || /Expires=Thu, 01 Jan 1970/i.test(cookie)))

describe("trusted browsers in two-step sign-in", () => {
  let t: TestApp
  beforeEach(async () => {
    t = await createTestApp()
  })
  afterEach(async () => {
    await t.close()
  })

  /** Turns on two-step sign-in for an account through its signed-in agent; returns its secret. */
  async function enableMfa(agent: Agent, email: string, password: string) {
    const setup = await agent.post("/api/auth/mfa/setup").send({ password }).expect(200)
    await agent.post("/api/auth/mfa/enable").send({ code: codeFor(setup.body.secret) }).expect(200)
    // Each later code in a test is accepted without waiting 30 seconds for a new time step.
    const allowReuse = () => t.db.update(users).set({ totpLastStep: null }).where(eq(users.email, email))
    return { secret: setup.body.secret as string, allowReuse }
  }

  async function ownerWithMfa() {
    const { agent, workspaceId } = await setupOwner(t)
    return { agent, workspaceId, ...(await enableMfa(agent, OWNER.email, OWNER.password)) }
  }

  /** Signs in with the password and the code on `agent` (a browser), trusting it when asked. */
  async function signIn(agent: Agent, secret: string, allowReuse: () => Promise<unknown>, opts: { trust?: boolean; email?: string; password?: string } = {}) {
    await allowReuse()
    const login = await agent.post("/api/auth/login").send({ email: opts.email ?? OWNER.email, password: opts.password ?? OWNER.password }).expect(200)
    expect(login.body).toEqual({ mfaRequired: true })
    return agent.post("/api/auth/mfa/verify").send({ code: codeFor(secret), ...(opts.trust ? { trustBrowser: true } : {}) }).expect(200)
  }

  it("trusts a browser when asked, then skips only the code on it", async () => {
    const { secret, allowReuse } = await ownerWithMfa()
    const browser = t.agent()

    // Not ticked: no cookie, nothing remembered.
    const plain = await signIn(browser, secret, allowReuse)
    expect(trustedSetCookie(plain)).toBeUndefined()
    expect((await browser.get("/api/auth/trusted-browsers").expect(200)).body).toEqual([])
    await browser.post("/api/auth/logout").expect(200)

    // Ticked: an httpOnly cookie scoped to /api/auth, for 30 days.
    const trusted = await signIn(browser, secret, allowReuse, { trust: true })
    const cookie = trustedSetCookie(trusted)!
    expect(cookie).toMatch(/HttpOnly/i)
    expect(cookie).toMatch(/Path=\/api\/auth/)
    expect(cookie).toMatch(/SameSite=Lax/i)
    expect(cookie).toMatch(/Max-Age=2592000/)
    const [row] = await t.db.select().from(trustedBrowsers)
    expect(row.tokenHash).not.toBe(tokenOf(cookie))
    expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBe(30 * 86_400_000)
    expect((await browser.get("/api/auth/trusted-browsers").expect(200)).body).toEqual([
      { id: row.id, label: row.label, createdAt: row.createdAt.toISOString(), lastUsedAt: null, expiresAt: row.expiresAt.toISOString(), current: true },
    ])
    await browser.post("/api/auth/logout").expect(200)

    // Next time on this browser the password alone is enough...
    const again = await browser.post("/api/auth/login").send({ email: OWNER.email, password: OWNER.password }).expect(200)
    expect(again.body.user.email).toBe(OWNER.email)
    expect((await browser.get("/api/auth/me").expect(200)).body.user.mfaEnabled).toBe(true)
    const latest = (await t.db.select().from(sessions)).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]
    expect(latest).toMatchObject({ assurance: "mfa", revokedAt: null })
    const [used] = await t.db.select().from(trustedBrowsers)
    expect(used.lastUsedAt).not.toBeNull()
    expect(used.expiresAt.getTime()).toBe(row.expiresAt.getTime())
    // ...but never without the password, and only on that browser.
    await browser.post("/api/auth/logout").expect(200)
    await browser.post("/api/auth/login").send({ email: OWNER.email, password: "not-my-password" }).expect(401)
    expect((await t.agent().post("/api/auth/login").send({ email: OWNER.email, password: OWNER.password }).expect(200)).body).toEqual({ mfaRequired: true })

    const actions = (await t.db.select().from(auditLog)).map((a) => a.action)
    expect(actions).toContain("Trusted a browser for 30 days")
    expect(actions).toContain("Signed in from a trusted browser")
  })

  it("works for a recovery code too", async () => {
    const { agent } = await setupOwner(t)
    const setup = await agent.post("/api/auth/mfa/setup").send({ password: OWNER.password }).expect(200)
    const enabled = await agent.post("/api/auth/mfa/enable").send({ code: codeFor(setup.body.secret) }).expect(200)
    const browser = t.agent()
    await browser.post("/api/auth/login").send({ email: OWNER.email, password: OWNER.password }).expect(200)
    const verified = await browser.post("/api/auth/mfa/verify").send({ code: enabled.body.recoveryCodes[0], trustBrowser: true }).expect(200)
    expect(trustedSetCookie(verified)).toBeTruthy()
    await browser.post("/api/auth/logout").expect(200)
    expect((await browser.post("/api/auth/login").send({ email: OWNER.email, password: OWNER.password }).expect(200)).body.user).toBeTruthy()
  })

  it("ignores another account's, an expired or a removed trusted browser, and clears its cookie", async () => {
    const { agent: owner, secret, allowReuse } = await ownerWithMfa()
    const devAgent = await addMember(t, owner, { email: DEV.email, role: "developer" })
    await enableMfa(devAgent, DEV.email, DEV.password)
    const browser = t.agent()
    const token = tokenOf(trustedSetCookie(await signIn(browser, secret, allowReuse, { trust: true })))

    // The owner's token on the developer's sign-in: still asks for the code, and drops the cookie.
    const other = await t.agent().post("/api/auth/login").set("Cookie", `${TRUSTED_COOKIE}=${token}`).send(DEV).expect(200)
    expect(other.body).toEqual({ mfaRequired: true })
    expect(clears(trustedSetCookie(other))).toBe(true)

    // Expired.
    await t.db.update(trustedBrowsers).set({ expiresAt: new Date(Date.now() - 1000) })
    const expired = await t.agent().post("/api/auth/login").set("Cookie", `${TRUSTED_COOKIE}=${token}`).send({ email: OWNER.email, password: OWNER.password }).expect(200)
    expect(expired.body).toEqual({ mfaRequired: true })
    expect(clears(trustedSetCookie(expired))).toBe(true)
    // Expired rows are cleared when their owner signs in.
    expect(await t.db.select().from(trustedBrowsers)).toEqual([])

    // Removed from Settings.
    const fresh = t.agent()
    const second = tokenOf(trustedSetCookie(await signIn(fresh, secret, allowReuse, { trust: true })))
    const [row] = await t.db.select().from(trustedBrowsers)
    await fresh.delete(`/api/auth/trusted-browsers/${row.id}`).expect(200)
    const removed = await t.agent().post("/api/auth/login").set("Cookie", `${TRUSTED_COOKIE}=${second}`).send({ email: OWNER.email, password: OWNER.password }).expect(200)
    expect(removed.body).toEqual({ mfaRequired: true })
    // A made-up token is no better.
    const madeUp = await t.agent().post("/api/auth/login").set("Cookie", `${TRUSTED_COOKIE}=${"x".repeat(43)}`).send({ email: OWNER.email, password: OWNER.password }).expect(200)
    expect(madeUp.body).toEqual({ mfaRequired: true })
  })

  it("lists and removes trusted browsers, one or all", async () => {
    const { secret, allowReuse } = await ownerWithMfa()
    const laptop = t.agent()
    const phone = t.agent()
    await signIn(laptop, secret, allowReuse, { trust: true })
    await signIn(phone, secret, allowReuse, { trust: true })
    const list = (await laptop.get("/api/auth/trusted-browsers").expect(200)).body as { id: string; current: boolean }[]
    expect(list).toHaveLength(2)
    expect(list.filter((b) => b.current)).toHaveLength(1)
    const phoneId = list.find((b) => !b.current)!.id

    // Removing another browser leaves this one's cookie alone; removing this one clears it.
    const other = await laptop.delete(`/api/auth/trusted-browsers/${phoneId}`).expect(200)
    expect(trustedSetCookie(other)).toBeUndefined()
    await laptop.delete(`/api/auth/trusted-browsers/${phoneId}`).expect(404)
    const all = await laptop.delete("/api/auth/trusted-browsers").expect(200)
    expect(all.body).toEqual({ removed: 1 })
    expect(clears(trustedSetCookie(all))).toBe(true)
    expect(await t.db.select().from(trustedBrowsers)).toEqual([])

    const actions = (await t.db.select().from(auditLog)).map((a) => a.action)
    expect(actions).toEqual(expect.arrayContaining(["Removed a trusted browser", "Removed all trusted browsers"]))
  })

  it("can't see or change another account's trusted browsers", async () => {
    const { agent: owner, secret, allowReuse } = await ownerWithMfa()
    await signIn(t.agent(), secret, allowReuse, { trust: true })
    const [row] = await t.db.select().from(trustedBrowsers)
    const devAgent = await addMember(t, owner, { email: DEV.email, role: "admin" })
    expect((await devAgent.get("/api/auth/trusted-browsers").expect(200)).body).toEqual([])
    await devAgent.delete(`/api/auth/trusted-browsers/${row.id}`).expect(404)
    expect((await devAgent.delete("/api/auth/trusted-browsers").expect(200)).body).toEqual({ removed: 0 })
    expect(await t.db.select().from(trustedBrowsers)).toHaveLength(1)
  })

  it("isn't reachable before the code is in", async () => {
    await ownerWithMfa()
    const pending = t.agent()
    await pending.post("/api/auth/login").send({ email: OWNER.email, password: OWNER.password }).expect(200)
    expect((await pending.get("/api/auth/trusted-browsers").expect(401)).body.error.code).toBe("mfa_required")
    await pending.delete("/api/auth/trusted-browsers").expect(401)
  })

  it("still asks for a fresh code before sensitive actions after a trusted sign-in", async () => {
    const { secret, allowReuse } = await ownerWithMfa()
    const browser = t.agent()
    await signIn(browser, secret, allowReuse, { trust: true })
    await browser.post("/api/auth/logout").expect(200)
    // The browser was trusted an hour ago.
    const hourAgo = new Date(Date.now() - 3600_000)
    await t.db.update(trustedBrowsers).set({ createdAt: hourAgo })
    await browser.post("/api/auth/login").send({ email: OWNER.email, password: OWNER.password }).expect(200)
    // The session's last proof of the code is when the browser was trusted, not now, so actions that need
    // a recent code (the platform console's changes) ask for one again.
    const latest = (await t.db.select().from(sessions)).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]
    expect(latest.authenticatedAt.getTime()).toBe(hourAgo.getTime())
    // Re-entering the password alone isn't enough; turning two-step off still needs a code.
    expect((await browser.post("/api/auth/reauth").send({ password: OWNER.password }).expect(422)).body.error.fields.code).toBeTruthy()
    await browser.post("/api/auth/mfa/disable").send({ password: OWNER.password, code: "000000" }).expect(422)
  })

  it("forgets every trusted browser when the password changes or is reset, or two-step is turned off or reset", async () => {
    const { agent, secret, allowReuse } = await ownerWithMfa()
    const trustOne = async () => {
      await signIn(t.agent(), secret, allowReuse, { trust: true })
      expect(await t.db.select().from(trustedBrowsers)).toHaveLength(1)
    }

    await trustOne()
    await agent.post("/api/auth/password").send({ currentPassword: OWNER.password, newPassword: "a-brand-new-password" }).expect(200)
    expect(await t.db.select().from(trustedBrowsers)).toEqual([])
    await agent.post("/api/auth/password").send({ currentPassword: "a-brand-new-password", newPassword: OWNER.password }).expect(200)

    await trustOne()
    await t.http().post("/api/auth/forgot").send({ email: OWNER.email }).expect(200)
    await t.jobs.runDue()
    const mail = t.mailer.outbox.find((m) => m.text.includes("reset-password?token="))!
    const resetToken = new URL(/https?:\/\/\S+reset-password\?token=\S+/.exec(mail.text)![0]).searchParams.get("token")!
    await t.http().post("/api/auth/reset").send({ token: resetToken, password: OWNER.password }).expect(200)
    expect(await t.db.select().from(trustedBrowsers)).toEqual([])

    await trustOne()
    const browser = t.agent()
    await signIn(browser, secret, allowReuse)
    await allowReuse()
    await browser.post("/api/auth/mfa/disable").send({ password: OWNER.password, code: codeFor(secret) }).expect(200)
    expect(await t.db.select().from(trustedBrowsers)).toEqual([])

    // Back on, trusted again, then reset by the server operator.
    const again = await enableMfa(browser, OWNER.email, OWNER.password)
    await signIn(t.agent(), again.secret, again.allowReuse, { trust: true })
    expect(await t.db.select().from(trustedBrowsers)).toHaveLength(1)
    expect(await resetTwoStep(t.db, OWNER.email)).toMatchObject({ kind: "reset" })
    expect(await t.db.select().from(trustedBrowsers)).toEqual([])
  })
})
