import { Inject, Injectable } from "@nestjs/common"
import type { MfaSetup, MfaStatus, SessionUser } from "@yaropay/core/auth"
import { and, eq, gt, isNull, lt, ne, or, sql } from "drizzle-orm"
import { AuditService } from "../audit/audit.service.js"
import { sha256 } from "../common/crypto.js"
import { EncryptionService } from "../common/encryption.service.js"
import { ApiException, conflict, invalid } from "../common/errors.js"
import { APP_CONFIG, type AppConfig } from "../config/config.js"
import { DB } from "../database/database.module.js"
import type { Db } from "../database/db.js"
import { sessions, type UserRow, users } from "../database/schema.js"
import { SettingsService } from "../settings/settings.service.js"
import { WorkspacesService } from "../workspaces/workspaces.service.js"
import { AuthService, type ClientMeta, describeAgent } from "./auth.service.js"
import { verifyPassword } from "./password.js"
import { generateRecoveryCodes, generateTotpSecret, normaliseRecoveryCode, otpauthUri, verifyTotp } from "./totp.js"
import { forgetTrustedBrowsers, TrustedBrowsersService } from "./trusted-browsers.js"
import type { Actor, SessionContext } from "./types.js"
import { OperatorSettingsService } from "../settings/operator-settings.service.js"

const DAY = 86_400_000
/** Wrong codes allowed on one pending session before it is ended. */
export const MAX_CODE_ATTEMPTS = 5
/** Wrong codes allowed per account per hour, across every pending session. */
export const MAX_CODE_ATTEMPTS_PER_HOUR = 20

const WRONG_CODE = "That code didn't match. Check the time on your phone and try again, or use a recovery code."

/**
 * Two-step sign-in with an authenticator app (TOTP), free in every edition. Requiring it for a whole
 * team is the paid part, later. Recovery codes are stored as hashes and each works once.
 */
@Injectable()
export class MfaService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly workspaces: WorkspacesService,
    private readonly encryption: EncryptionService,
    private readonly trusted: TrustedBrowsersService,
    private readonly operator: OperatorSettingsService,
  ) {}

  private async user(id: string): Promise<UserRow> {
    const [row] = await this.db.select().from(users).where(eq(users.id, id))
    return row
  }

  async status(actor: Actor): Promise<MfaStatus> {
    const u = await this.user(actor.id)
    return { enabled: u.totpEnabledAt !== null, enabledAt: u.totpEnabledAt?.toISOString() ?? null, recoveryCodesLeft: u.totpEnabledAt ? u.recoveryCodeHashes.length : 0 }
  }

  private async checkPassword(u: UserRow, password: string) {
    if (!(await verifyPassword(password, u.passwordHash))) throw invalid({ password: "That password is incorrect" }, "That password is incorrect")
  }

  /** Starts setup: a new secret, kept aside until the first code from the app confirms it. */
  async startSetup(actor: Actor, password: string): Promise<MfaSetup> {
    const u = await this.user(actor.id)
    await this.checkPassword(u, password)
    if (u.totpEnabledAt) throw conflict("Two-step sign-in is already on. Turn it off first to move it to a new phone.")
    const secret = generateTotpSecret()
    await this.db.update(users).set({ totpPendingSecretEnc: this.encryption.encrypt(secret), updatedAt: new Date() }).where(eq(users.id, u.id))
    const { platformName } = await this.settings.install()
    return { secret, otpauthUri: otpauthUri({ issuer: platformName, account: u.email, secret }) }
  }

  /** Confirms setup with a code. Other sessions are signed out, since they never showed a code. */
  async enable(actor: Actor, session: SessionContext, code: string, meta: ClientMeta): Promise<{ recoveryCodes: string[] }> {
    const u = await this.user(actor.id)
    if (u.totpEnabledAt) throw conflict("Two-step sign-in is already on.")
    if (!u.totpPendingSecretEnc) throw conflict("Start setting up two-step sign-in first.")
    const step = verifyTotp(this.encryption.decrypt(u.totpPendingSecretEnc), code)
    if (step === null) throw invalid({ code: "That code didn't match. Check the time on your phone and try again." })
    const codes = generateRecoveryCodes()
    const now = new Date()
    await this.db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({
          totpSecretEnc: u.totpPendingSecretEnc,
          totpPendingSecretEnc: null,
          totpEnabledAt: now,
          totpLastStep: step,
          recoveryCodeHashes: codes.map((c) => sha256(normaliseRecoveryCode(c))),
          updatedAt: now,
        })
        .where(eq(users.id, u.id))
      await tx.update(sessions).set({ assurance: "mfa", authenticatedAt: now }).where(eq(sessions.id, session.id))
      await tx
        .update(sessions)
        .set({ revokedAt: now })
        .where(and(eq(sessions.userId, u.id), ne(sessions.id, session.id), isNull(sessions.revokedAt)))
    })
    await this.recordEverywhere(u, "Turned on two-step sign-in", meta)
    await this.auth.sendMail(u.email, "Two-step sign-in is on", [
      `Signing in to ${u.email} now needs a code from your authenticator app as well as your password. Other sessions were signed out.`,
      "Keep your recovery codes somewhere safe: each one gets you in once if you lose your phone.",
      "If this wasn't you, reset your password right away.",
    ])
    return { recoveryCodes: codes }
  }

  /** Turning it off needs the password and a code, so a stolen session alone can't do it. */
  async disable(actor: Actor, password: string, code: string, meta: ClientMeta) {
    const u = await this.user(actor.id)
    if (!u.totpEnabledAt) throw conflict("Two-step sign-in is already off.")
    await this.checkPassword(u, password)
    if (!(await this.checkSecondFactor(u, code))) throw invalid({ code: WRONG_CODE })
    const now = new Date()
    await this.db
      .update(users)
      .set({ totpSecretEnc: null, totpPendingSecretEnc: null, totpEnabledAt: null, totpLastStep: null, recoveryCodeHashes: [], updatedAt: now })
      .where(eq(users.id, u.id))
    await this.db.update(sessions).set({ assurance: "password" }).where(and(eq(sessions.userId, u.id), eq(sessions.assurance, "mfa")))
    await forgetTrustedBrowsers(this.db, u.id)
    await this.recordEverywhere(u, "Turned off two-step sign-in", meta)
    await this.auth.sendMail(u.email, "Two-step sign-in is off", [
      `Signing in to ${u.email} needs only your password again.`,
      "If this wasn't you, reset your password and turn two-step sign-in back on.",
    ])
  }

  /** New recovery codes; the old ones stop working. */
  async regenerateRecoveryCodes(actor: Actor, password: string, meta: ClientMeta): Promise<{ recoveryCodes: string[] }> {
    const u = await this.user(actor.id)
    if (!u.totpEnabledAt) throw conflict("Turn on two-step sign-in first.")
    await this.checkPassword(u, password)
    const codes = generateRecoveryCodes()
    await this.db
      .update(users)
      .set({ recoveryCodeHashes: codes.map((c) => sha256(normaliseRecoveryCode(c))), updatedAt: new Date() })
      .where(eq(users.id, u.id))
    await this.recordEverywhere(u, "Made new recovery codes", meta)
    return { recoveryCodes: codes }
  }

  /**
   * The code step of signing in. Too many wrong codes end the pending session, so guessing means
   * starting over with the password each time (and the sign-in limit applies to that). With
   * `trustBrowser`, it also returns a token for the trusted-browser cookie.
   */
  async verify(
    actor: Actor,
    session: SessionContext,
    code: string,
    meta: ClientMeta,
    opts: { trustBrowser?: boolean } = {},
  ): Promise<{ user: SessionUser; trusted: { token: string; expiresAt: Date } | null }> {
    if (session.assurance !== "pending") throw conflict("This session is already signed in.")
    const u = await this.user(actor.id)
    // Someone who has the password could otherwise keep starting new sessions for fresh guesses.
    const [{ recent }] = await this.db
      .select({ recent: sql<number>`coalesce(sum(${sessions.mfaFailures}), 0)::int` })
      .from(sessions)
      .where(and(eq(sessions.userId, u.id), gt(sessions.createdAt, new Date(Date.now() - 3600_000))))
    if (recent >= MAX_CODE_ATTEMPTS_PER_HOUR) {
      throw new ApiException(429, "Too many wrong codes for this account. Try again in an hour, or use a recovery code later.", { code: "mfa_rate_limited" })
    }
    const ok = u.totpEnabledAt ? await this.checkSecondFactor(u, code) : false
    if (!ok) {
      const [row] = await this.db
        .update(sessions)
        .set({ mfaFailures: sql`${sessions.mfaFailures} + 1` })
        .where(eq(sessions.id, session.id))
        .returning({ failures: sessions.mfaFailures })
      if (!row || row.failures >= MAX_CODE_ATTEMPTS) {
        await this.db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, session.id))
        // Getting this far means the password was right: the owner should know.
        await this.auth.sendMail(u.email, "Someone entered your password but not your code", [
          `Someone signed in to ${u.email} with the right password from ${meta.ip ?? "an unknown address"}, then entered ${MAX_CODE_ATTEMPTS} wrong authenticator codes.`,
          "If this wasn't you, change your password now. Your account is still protected by two-step sign-in.",
        ])
        throw new ApiException(401, "Too many wrong codes. Sign in again.", { code: "mfa_locked" })
      }
      throw invalid({ code: WRONG_CODE }, WRONG_CODE)
    }
    const now = new Date()
    await this.db
      .update(sessions)
      .set({ assurance: "mfa", authenticatedAt: now, lastSeenAt: now, mfaFailures: 0, expiresAt: new Date(now.getTime() + this.operator.sessionDays() * DAY) })
      .where(eq(sessions.id, session.id))
    await this.auth.signedIn(u, actor.workspaceId, meta, session.id)
    let trusted: { token: string; expiresAt: Date } | null = null
    if (opts.trustBrowser) {
      const label = describeAgent(meta.userAgent)
      trusted = await this.trusted.trust(u.id, label)
      await this.audit.record({ workspaceId: actor.workspaceId, actorId: u.id, actorName: u.name, ip: meta.ip }, "Trusted a browser for 30 days", label)
    }
    return { user: await this.auth.sessionUser({ ...actor, mfaEnabled: true }), trusted }
  }

  /** Confirms the password (and code, when two-step sign-in is on) again before a sensitive action. */
  async reauthenticate(actor: Actor, session: SessionContext, password: string, code: string | undefined) {
    const u = await this.user(actor.id)
    await this.checkPassword(u, password)
    if (u.totpEnabledAt) {
      if (!code) throw invalid({ code: "Enter the code from your authenticator app" })
      if (!(await this.checkSecondFactor(u, code))) throw invalid({ code: WRONG_CODE })
    }
    const now = new Date()
    await this.db
      .update(sessions)
      .set({ authenticatedAt: now, ...(u.totpEnabledAt ? { assurance: "mfa" } : {}) })
      .where(eq(sessions.id, session.id))
    return { authenticatedAt: now.toISOString() }
  }

  /**
   * A 6-digit authenticator code, or one of the recovery codes. Each is accepted once: the code's time
   * step is stored and a recovery code's hash is removed, both in a single conditional update, so two
   * requests racing with the same code can't both succeed.
   */
  private async checkSecondFactor(u: UserRow, input: string): Promise<boolean> {
    const code = input.trim()
    if (/^\d{6}$/.test(code)) {
      if (!u.totpSecretEnc) return false
      const step = verifyTotp(this.encryption.decrypt(u.totpSecretEnc), code, { lastStep: u.totpLastStep })
      if (step === null) return false
      const claimed = await this.db
        .update(users)
        .set({ totpLastStep: step })
        .where(and(eq(users.id, u.id), or(isNull(users.totpLastStep), lt(users.totpLastStep, step))))
        .returning({ id: users.id })
      return claimed.length > 0
    }
    const hash = sha256(normaliseRecoveryCode(code))
    const [used] = await this.db
      .update(users)
      .set({ recoveryCodeHashes: sql`array_remove(${users.recoveryCodeHashes}, ${hash})` })
      .where(and(eq(users.id, u.id), sql`${hash} = any(${users.recoveryCodeHashes})`))
      .returning({ left: users.recoveryCodeHashes })
    if (!used) return false
    await this.auth.sendMail(u.email, "A recovery code was used", [
      `Someone signed in to ${u.email} with one of your recovery codes. ${used.left.length} left.`,
      used.left.length <= 3 ? "Make new ones from Settings, Security, before you run out." : "If this wasn't you, reset your password right away.",
    ])
    return true
  }

  /** The account belongs to every workspace the person is in: each one's audit log hears about it. */
  private async recordEverywhere(u: UserRow, action: string, meta: ClientMeta) {
    for (const w of await this.workspaces.membershipsOf(u.id)) {
      await this.audit.record({ workspaceId: w.id, actorId: u.id, actorName: u.name, ip: meta.ip }, action, u.email)
    }
  }
}
