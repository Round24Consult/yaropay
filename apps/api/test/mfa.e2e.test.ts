import { and, eq } from "drizzle-orm"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { resetTwoStep } from "../src/auth/account-repairs.js"
import { MAX_CODE_ATTEMPTS, MAX_CODE_ATTEMPTS_PER_HOUR } from "../src/auth/mfa.service.js"
import { base32Decode, totpCode, totpStep } from "../src/auth/totp.js"
import { auditLog, jobs, sessions, users } from "../src/database/schema.js"
import { addMember, createTestApp, OWNER, setupOwner, type TestApp } from "./helpers.js"

/** The code an authenticator app would show, `offset` steps from now. */
const codeFor = (secret: string, offset = 0) => totpCode(base32Decode(secret), totpStep() + offset)

describe("two-step sign-in", () => {
  let t: TestApp
  beforeEach(async () => {
    t = await createTestApp()
  })
  afterEach(async () => {
    await t.close()
  })

  /** Sets up the owner with two-step sign-in on; returns the secret and recovery codes. */
  async function ownerWithMfa() {
    const { agent, workspaceId } = await setupOwner(t)
    const setup = await agent.post("/api/auth/mfa/setup").send({ password: OWNER.password }).expect(200)
    const secret = setup.body.secret as string
    const enabled = await agent.post("/api/auth/mfa/enable").send({ code: codeFor(secret) }).expect(200)
    // Later steps in a test start from a clean slate rather than waiting 30 seconds per code.
    const allowReuse = () => t.db.update(users).set({ totpLastStep: null }).where(eq(users.email, OWNER.email))
    return { agent, workspaceId, secret, recoveryCodes: enabled.body.recoveryCodes as string[], allowReuse }
  }

  async function signInPending() {
    const agent = t.agent()
    const res = await agent.post("/api/auth/login").send({ email: OWNER.email, password: OWNER.password }).expect(200)
    expect(res.body).toEqual({ mfaRequired: true })
    return agent
  }

  it("needs the password to start and a correct code to finish setting up", async () => {
    const { agent } = await setupOwner(t)
    expect((await agent.get("/api/auth/mfa").expect(200)).body).toEqual({ enabled: false, enabledAt: null, recoveryCodesLeft: 0 })
    const wrongPassword = await agent.post("/api/auth/mfa/setup").send({ password: "not-my-password" }).expect(422)
    expect(wrongPassword.body.error.fields.password).toBeTruthy()
    await agent.post("/api/auth/mfa/enable").send({ code: "123456" }).expect(409)

    const setup = await agent.post("/api/auth/mfa/setup").send({ password: OWNER.password }).expect(200)
    expect(setup.body.secret).toMatch(/^[A-Z2-7]{32}$/)
    expect(setup.body.otpauthUri).toBe(
      `otpauth://totp/YaroPay%3A${encodeURIComponent(OWNER.email)}?secret=${setup.body.secret}&issuer=YaroPay&algorithm=SHA1&digits=6&period=30`,
    )
    const [stored] = await t.db.select().from(users).where(eq(users.email, OWNER.email))
    expect(stored.totpPendingSecretEnc).not.toContain(setup.body.secret)
    expect(stored.totpEnabledAt).toBeNull()

    const wrong = codeFor(setup.body.secret) === "000000" ? "111111" : "000000"
    expect((await agent.post("/api/auth/mfa/enable").send({ code: wrong }).expect(422)).body.error.fields.code).toMatch(/didn't match/)
    const ok = await agent.post("/api/auth/mfa/enable").send({ code: codeFor(setup.body.secret) }).expect(200)
    expect(ok.body.recoveryCodes).toHaveLength(10)
    expect((await agent.get("/api/auth/mfa").expect(200)).body).toMatchObject({ enabled: true, recoveryCodesLeft: 10 })
    expect((await agent.get("/api/auth/me").expect(200)).body.user.mfaEnabled).toBe(true)
    await agent.post("/api/auth/mfa/setup").send({ password: OWNER.password }).expect(409)

    const audit = await t.db.select().from(auditLog).where(eq(auditLog.action, "Turned on two-step sign-in"))
    expect(audit).toHaveLength(1)
    const mail = await t.db.select().from(jobs).where(eq(jobs.kind, "email"))
    expect(mail.some((j) => String(j.payload.subject).includes("Two-step sign-in is on"))).toBe(true)
  })

  it("signs out the account's other sessions when it is turned on", async () => {
    const { agent } = await setupOwner(t)
    const laptop = t.agent()
    await laptop.post("/api/auth/login").send({ email: OWNER.email, password: OWNER.password }).expect(200)
    await laptop.get("/api/auth/me").expect(200)
    const setup = await agent.post("/api/auth/mfa/setup").send({ password: OWNER.password }).expect(200)
    await agent.post("/api/auth/mfa/enable").send({ code: codeFor(setup.body.secret) }).expect(200)
    await laptop.get("/api/auth/me").expect(401)
    await agent.get("/api/auth/me").expect(200)
  })

  it("holds a signed-in password at the code step until a code is entered", async () => {
    const { secret } = await ownerWithMfa()
    const pending = await signInPending()

    // Only the code step and signing out are reachable.
    const me = await pending.get("/api/auth/me").expect(401)
    expect(me.body.error.code).toBe("mfa_required")
    expect((await pending.get("/api/products").expect(401)).body.error.code).toBe("mfa_required")
    expect((await pending.get("/api/auth/mfa").expect(401)).body.error.code).toBe("mfa_required")
    const [row] = await t.db.select().from(sessions).where(eq(sessions.assurance, "pending"))
    expect(row.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(10 * 60_000)

    const verified = await pending.post("/api/auth/mfa/verify").send({ code: codeFor(secret, 1) }).expect(200)
    expect(verified.body.user).toMatchObject({ email: OWNER.email, mfaEnabled: true })
    expect(String(verified.headers["set-cookie"])).toMatch(/yaropay_session=/)
    await pending.get("/api/auth/me").expect(200)
    await pending.get("/api/products").expect(200)
    const [after] = await t.db.select().from(sessions).where(eq(sessions.id, row.id))
    expect(after.assurance).toBe("mfa")
    expect(after.expiresAt.getTime() - Date.now()).toBeGreaterThan(24 * 3600_000)

    // A finished session has nothing left to verify.
    await pending.post("/api/auth/mfa/verify").send({ code: codeFor(secret) }).expect(409)
  })

  it("refuses a code that was already used", async () => {
    const { secret } = await ownerWithMfa()
    const code = codeFor(secret, 1)
    await (await signInPending()).post("/api/auth/mfa/verify").send({ code }).expect(200)
    const replay = await (await signInPending()).post("/api/auth/mfa/verify").send({ code }).expect(422)
    expect(replay.body.error.fields.code).toMatch(/didn't match/)
  })

  it("accepts each recovery code once, however it is typed", async () => {
    const { recoveryCodes } = await ownerWithMfa()
    const first = recoveryCodes[0]
    const typed = ` ${first.replace(/-/g, "").toUpperCase()} `
    const agent = await signInPending()
    await agent.post("/api/auth/mfa/verify").send({ code: typed }).expect(200)
    expect((await agent.get("/api/auth/mfa").expect(200)).body.recoveryCodesLeft).toBe(9)
    await (await signInPending()).post("/api/auth/mfa/verify").send({ code: first }).expect(422)
    const mail = await t.db.select().from(jobs).where(eq(jobs.kind, "email"))
    expect(mail.some((j) => String(j.payload.subject).includes("A recovery code was used"))).toBe(true)
  })

  it("ends the pending session after too many wrong codes", async () => {
    const { secret } = await ownerWithMfa()
    const agent = await signInPending()
    const wrong = codeFor(secret, 1) === "000000" ? "111111" : "000000"
    for (let i = 1; i < MAX_CODE_ATTEMPTS; i++) await agent.post("/api/auth/mfa/verify").send({ code: wrong }).expect(422)
    expect((await agent.post("/api/auth/mfa/verify").send({ code: wrong }).expect(401)).body.error.code).toBe("mfa_locked")
    // Even the right code no longer helps: start over with the password.
    await agent.post("/api/auth/mfa/verify").send({ code: codeFor(secret, 1) }).expect(401)
    const mail = await t.db.select().from(jobs).where(eq(jobs.kind, "email"))
    expect(mail.some((j) => String(j.payload.subject).includes("Someone entered your password but not your code"))).toBe(true)
  })

  it("caps wrong codes per account, not just per session", async () => {
    const { secret } = await ownerWithMfa()
    const wrong = codeFor(secret, 1) === "000000" ? "111111" : "000000"
    for (let round = 0; round < MAX_CODE_ATTEMPTS_PER_HOUR / MAX_CODE_ATTEMPTS; round++) {
      const agent = await signInPending()
      for (let i = 1; i < MAX_CODE_ATTEMPTS; i++) await agent.post("/api/auth/mfa/verify").send({ code: wrong }).expect(422)
      await agent.post("/api/auth/mfa/verify").send({ code: wrong }).expect(401)
    }
    const limited = await (await signInPending()).post("/api/auth/mfa/verify").send({ code: codeFor(secret, 1) }).expect(429)
    expect(limited.body.error.code).toBe("mfa_rate_limited")
  })

  it("needs the password and a code to turn it off", async () => {
    const { agent, secret, allowReuse } = await ownerWithMfa()
    await agent.post("/api/auth/mfa/disable").send({ password: "wrong-password", code: codeFor(secret) }).expect(422)
    await agent.post("/api/auth/mfa/disable").send({ password: OWNER.password, code: "000000" === codeFor(secret) ? "111111" : "000000" }).expect(422)
    await allowReuse()
    await agent.post("/api/auth/mfa/disable").send({ password: OWNER.password, code: codeFor(secret) }).expect(200)
    expect((await agent.get("/api/auth/mfa").expect(200)).body).toEqual({ enabled: false, enabledAt: null, recoveryCodesLeft: 0 })
    const login = await t.agent().post("/api/auth/login").send({ email: OWNER.email, password: OWNER.password }).expect(200)
    expect(login.body.user.mfaEnabled).toBe(false)
  })

  it("makes new recovery codes and retires the old ones", async () => {
    const { agent, recoveryCodes } = await ownerWithMfa()
    await agent.post("/api/auth/mfa/recovery-codes").send({ password: "wrong-password" }).expect(422)
    const fresh = await agent.post("/api/auth/mfa/recovery-codes").send({ password: OWNER.password }).expect(200)
    expect(fresh.body.recoveryCodes).toHaveLength(10)
    await (await signInPending()).post("/api/auth/mfa/verify").send({ code: recoveryCodes[0] }).expect(422)
    await (await signInPending()).post("/api/auth/mfa/verify").send({ code: fresh.body.recoveryCodes[0] }).expect(200)
  })

  it("confirms the password and code again before sensitive actions", async () => {
    const { agent, secret, workspaceId } = await ownerWithMfa()
    await t.db.update(sessions).set({ authenticatedAt: new Date(Date.now() - 3600_000) })
    await agent.post("/api/auth/reauth").send({ password: OWNER.password }).expect(422)
    await agent.post("/api/auth/reauth").send({ password: "wrong-password", code: codeFor(secret, 1) }).expect(422)
    const ok = await agent.post("/api/auth/reauth").send({ password: OWNER.password, code: codeFor(secret, 1) }).expect(200)
    expect(Date.now() - Date.parse(ok.body.authenticatedAt)).toBeLessThan(5_000)
    const [row] = await t.db.select().from(sessions).where(and(eq(sessions.workspaceId, workspaceId), eq(sessions.assurance, "mfa")))
    expect(Date.now() - row.authenticatedAt.getTime()).toBeLessThan(5_000)
  })

  it("asks an existing account for its code when it joins by invite", async () => {
    const { agent: owner } = await setupOwner(t)
    const dev = await addMember(t, owner, { email: "dev@example.test", role: "developer" })
    const setup = await dev.post("/api/auth/mfa/setup").send({ password: "another-long-password" }).expect(200)
    await dev.post("/api/auth/mfa/enable").send({ code: codeFor(setup.body.secret) }).expect(200)
    // Removed, then invited back: the existing account joins with its password, then owes its code.
    const team = (await owner.get("/api/team").expect(200)).body as { id: string; email: string }[]
    await owner.delete(`/api/team/${team.find((m) => m.email === "dev@example.test")!.id}`).expect(200)
    const inv = await owner.post("/api/team/invites").send({ email: "dev@example.test", role: "viewer", productIds: null }).expect(201)
    const token = String(inv.body.inviteUrl).split("/invite/")[1]
    const back = t.agent()
    const joined = await back.post(`/api/auth/invites/${token}/join`).send({ password: "another-long-password" }).expect(201)
    expect(joined.body).toEqual({ mfaRequired: true })
    expect((await back.get("/api/auth/me").expect(401)).body.error.code).toBe("mfa_required")
    const verified = await back.post("/api/auth/mfa/verify").send({ code: codeFor(setup.body.secret, 1) }).expect(200)
    expect(verified.body.user.role).toBe("viewer")
  })

  it("lets the server operator turn it off for someone locked out", async () => {
    const { agent } = await ownerWithMfa()
    expect(await resetTwoStep(t.db, "nobody@example.test")).toEqual({ kind: "no_account" })
    expect(await resetTwoStep(t.db, OWNER.email.toUpperCase())).toEqual({ kind: "reset", email: OWNER.email })
    await agent.get("/api/auth/me").expect(401)
    const login = await t.agent().post("/api/auth/login").send({ email: OWNER.email, password: OWNER.password }).expect(200)
    expect(login.body.user.mfaEnabled).toBe(false)
    const audit = await t.db.select().from(auditLog).where(eq(auditLog.actorName, "Server operator"))
    expect(audit.map((a) => a.action)).toEqual(["Turned off two-step sign-in"])
    expect(await resetTwoStep(t.db, OWNER.email)).toEqual({ kind: "already_off", email: OWNER.email })
  })
})
