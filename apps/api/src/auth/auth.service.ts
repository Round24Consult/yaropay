import { Inject, Injectable } from "@nestjs/common"
import {
  type AuthState,
  type InvitePreview,
  type Permission,
  type Role,
  type SessionInfo,
  type SessionUser,
  type SetupInput,
  SUPPORT_PERMISSIONS,
  type WorkspaceSummary,
} from "@yaropay/core/auth"
import { and, count, desc, eq, gt, isNull, ne, sql } from "drizzle-orm"
import { AuditService } from "../audit/audit.service.js"
import { newId, randomToken, safeEqual, sha256 } from "../common/crypto.js"
import { ApiException, conflict, gone, notFound, unauthenticated } from "../common/errors.js"
import { APP_CONFIG, type AppConfig } from "../config/config.js"
import type { Edition } from "@yaropay/core/editions"
import { EDITION, PERMISSION_RESOLVER, type PermissionResolver } from "../extension/extension.js"
import { DB } from "../database/database.module.js"
import type { Db, DbOrTx } from "../database/db.js"
import { invites, passwordResets, type SessionRow, sessions, type UserRow, users, workspaceMembers, workspaces } from "../database/schema.js"
import { MailerService, renderEmail } from "../notifications/mailer.service.js"
import { NotificationsService } from "../notifications/notifications.service.js"
import { JobsService } from "../notifications/jobs.service.js"
import { SettingsService } from "../settings/settings.service.js"
import { WorkspacesService } from "../workspaces/workspaces.service.js"
import { dummyHash, hashPassword, verifyPassword } from "./password.js"
import { forgetTrustedBrowsers, TrustedBrowsersService } from "./trusted-browsers.js"
import type { Actor, Assurance, SessionContext } from "./types.js"
import { OperatorSettingsService } from "../settings/operator-settings.service.js"

export const SESSION_COOKIE = "yaropay_session"
const DAY = 86_400_000
const TOUCH_EVERY_MS = 5 * 60_000
/** A session waiting for its authenticator code lasts this long. */
export const PENDING_SESSION_MS = 10 * 60_000


export interface ClientMeta {
  ip: string | null
  userAgent: string | null
}

export interface Membership {
  workspaceId: string
  role: string
  productIds: string[] | null
}

export function toActor(u: UserRow, m: Membership, permissions: readonly Permission[]): Actor {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    workspaceId: m.workspaceId,
    role: m.role as Role,
    productIds: m.productIds ?? null,
    permissions,
    mfaEnabled: u.totpEnabledAt !== null,
    platformRole: u.platformRole === "super_admin" ? "super_admin" : null,
    createdAt: u.createdAt,
  }
}

export function toSessionUser(a: Actor, memberships: WorkspaceSummary[]): SessionUser {
  const current = memberships.find((w) => w.id === a.workspaceId)
  return {
    id: a.id,
    name: a.name,
    email: a.email,
    role: a.role,
    productIds: a.productIds,
    permissions: [...a.permissions],
    createdAt: a.createdAt.toISOString(),
    workspace: { id: a.workspaceId, name: current?.name ?? "" },
    workspaces: memberships.map(({ id, name, role }) => ({ id, name, role })),
    mfaEnabled: a.mfaEnabled,
    platformRole: a.platformRole,
    support: a.support ? { reason: a.support.reason, expiresAt: a.support.expiresAt.toISOString() } : null,
  }
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly mailer: MailerService,
    private readonly jobs: JobsService,
    private readonly notifications: NotificationsService,
    private readonly workspaces: WorkspacesService,
    @Inject(PERMISSION_RESOLVER) private readonly permissionResolver: PermissionResolver,
    @Inject(EDITION) private readonly edition: Edition,
    private readonly trusted: TrustedBrowsersService,
    private readonly operator: OperatorSettingsService,
  ) {}

  /** The member's permissions in their workspace: the role's, unless the paid build says otherwise. */
  private permissionsOf(userId: string, m: Membership): Promise<readonly Permission[]> {
    return this.permissionResolver.resolve({ workspaceId: m.workspaceId, userId, role: m.role as Role })
  }

  /** The signed-in member as the dashboard sees them, with the workspaces they can switch to. */
  async sessionUser(actor: Actor): Promise<SessionUser> {
    const user = toSessionUser(actor, await this.workspaces.membershipsOf(actor.id))
    // A support view isn't a membership: name the company being viewed from its own row.
    if (actor.support) {
      const [w] = await this.db.select({ name: workspaces.name }).from(workspaces).where(eq(workspaces.id, actor.workspaceId))
      user.workspace = { id: actor.workspaceId, name: w?.name ?? "" }
    }
    return user
  }

  private hash(password: string) {
    return hashPassword(password, this.operator.passwordCost())
  }

  async state(): Promise<AuthState> {
    const [{ n }] = await this.db.select({ n: count() }).from(users)
    const signupEnabled = this.edition === "cloud" && n > 0 && (await this.settings.install()).signupsOpen
    return { needsSetup: n === 0, emailEnabled: this.mailer.enabled, setupTokenRequired: n === 0 && this.config.setupToken !== null, signupEnabled }
  }

  /** First run: creates the owner account. Refused once any user exists. */
  async setup(input: SetupInput, meta: ClientMeta) {
    // On an internet-facing install, whoever opens /setup first would otherwise become the owner.
    if (this.config.setupToken && !safeEqual(input.setupToken ?? "", this.config.setupToken)) {
      throw new ApiException(403, "This install needs its setup token. Find SETUP_TOKEN in the server's .env file.", {
        code: "setup_token_invalid",
        fields: { setupToken: "That setup token doesn't match" },
      })
    }
    const passwordHash = await this.hash(input.password)
    const { user, member } = await this.db.transaction(async (tx) => {
      // Serialise concurrent setup attempts.
      await tx.execute(sql`select pg_advisory_xact_lock(4242)`)
      const [{ n }] = await tx.select({ n: count() }).from(users)
      if (n > 0) throw conflict("This install is already set up. Sign in instead.")
      const [row] = await tx
        .insert(users)
        .values({ id: newId("usr"), email: input.email, name: input.name, passwordHash, lastActiveAt: new Date() })
        .returning()
      // An install upgraded before anyone signed up already has its company: claim it instead of adding one.
      const ws = (await this.workspaces.unclaimed(tx)) ?? (await this.workspaces.create({ name: input.companyName }, tx))
      await this.settings.update(ws.id, { companyName: input.companyName }, tx)
      const member = await this.workspaces.addMember({ workspaceId: ws.id, userId: row.id, role: "owner", productIds: null }, tx)
      await this.audit.record({ workspaceId: ws.id, actorId: row.id, actorName: row.name, ip: meta.ip }, "Set up the install", input.companyName, tx)
      return { user: row, member }
    })
    const token = await this.createSession(user.id, member.workspaceId, meta)
    return { user: await this.sessionUser(toActor(user, member, await this.permissionsOf(user.id, member))), token }
  }

  /**
   * Signs in with a password. With two-step sign-in on, the session waits for the authenticator code,
   * unless `trustedToken` is a browser this same person trusted (and hasn't expired or been removed).
   * `clearTrusted` asks the caller to drop a trusted-browser cookie that no longer means anything.
   */
  async login(email: string, password: string, meta: ClientMeta, trustedToken?: string) {
    const [user] = await this.db
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = ${email.toLowerCase()}`)
    if (!user) {
      await verifyPassword(password, await dummyHash(this.operator.passwordCost()))
      throw unauthenticated("Email or password is incorrect")
    }
    if (!(await verifyPassword(password, user.passwordHash))) throw unauthenticated("Email or password is incorrect")
    // Disabled everywhere by the platform. The password was right, so saying so is safe.
    if (user.disabledAt) {
      throw new ApiException(403, "This account is disabled. Contact YaroPay support.", { code: "account_disabled" })
    }
    // A Cloud sign-up that hasn't clicked its emailed link yet. The password was right, so saying so is safe.
    if (!user.emailVerifiedAt) {
      throw new ApiException(403, "Confirm your email address first: open the link we sent you, or ask for a new one.", { code: "email_unverified" })
    }
    // Removed from every workspace: the account can't sign in, and the answer doesn't say why.
    const memberships = await this.workspaces.membershipsOf(user.id)
    if (!memberships.length) {
      // The password was right, so saying the company is suspended gives nothing away.
      if (await this.workspaces.hasSuspendedMembership(user.id)) {
        throw new ApiException(403, "This company's YaroPay account is suspended. Contact YaroPay support.", { code: "workspace_suspended" })
      }
      throw unauthenticated("Email or password is incorrect")
    }
    const workspaceId = memberships[0].id
    const member = (await this.workspaces.member(workspaceId, user.id))!

    // With two-step sign-in on, the session only becomes usable once the authenticator code is in,
    // unless this browser was trusted when the code was last entered on it.
    if (user.totpEnabledAt) {
      await this.trusted.pruneExpired(user.id)
      const trust = await this.trusted.check(trustedToken, user.id)
      if (trust) {
        // It counts as a two-step sign-in, but authenticatedAt is when the code was actually entered, so
        // actions that need a recent code (the platform console's changes) still ask for one.
        const { token, id } = await this.createSessionRow(user.id, workspaceId, meta, this.db, { assurance: "mfa", authenticatedAt: trust.createdAt })
        await this.signedIn(user, workspaceId, meta, id)
        await this.audit.record({ workspaceId, actorId: user.id, actorName: user.name, ip: meta.ip }, "Signed in from a trusted browser", trust.label)
        return { user: toSessionUser(toActor(user, member, await this.permissionsOf(user.id, member)), memberships), token }
      }
      const token = await this.createSession(user.id, workspaceId, meta, this.db, { pending: true })
      return { mfaRequired: true as const, token, clearTrusted: Boolean(trustedToken) }
    }
    const { token, id } = await this.createSessionRow(user.id, workspaceId, meta)
    await this.signedIn(user, workspaceId, meta, id)
    return { user: toSessionUser(toActor(user, member, await this.permissionsOf(user.id, member)), memberships), token, clearTrusted: Boolean(trustedToken) }
  }

  /** After a full sign-in: marks the account active and warns about a browser not seen before. */
  async signedIn(user: UserRow, workspaceId: string, meta: ClientMeta, sessionId: string) {
    const now = new Date()
    await this.db.update(users).set({ lastActiveAt: now }).where(eq(users.id, user.id))
    await this.db
      .update(workspaceMembers)
      .set({ lastActiveAt: now })
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, user.id)))
    const known = await this.db
      .select({ ua: sessions.userAgent })
      .from(sessions)
      .where(and(eq(sessions.userId, user.id), ne(sessions.id, sessionId), ne(sessions.assurance, "pending")))
      .orderBy(desc(sessions.createdAt))
      .limit(50)
    if (known.length > 0 && !known.some((s) => s.ua === meta.userAgent)) {
      await this.notifications.notify({
        workspaceId,
        type: "security.new_login",
        userId: user.id,
        severity: "warning",
        title: "New sign-in to your account",
        body: `Signed in from ${describeAgent(meta.userAgent)}${meta.ip ? ` (${meta.ip})` : ""}. If this wasn't you, change your password and sign out other sessions.`,
        link: "/settings?tab=security",
      })
    }
  }

  /** Signs a user in to their most recently used workspace (after confirming their email, say). */
  async startSession(user: UserRow, meta: ClientMeta): Promise<{ user: SessionUser; token: string } | null> {
    const memberships = await this.workspaces.membershipsOf(user.id)
    if (!memberships.length) return null
    const member = (await this.workspaces.member(memberships[0].id, user.id))!
    const { token, id } = await this.createSessionRow(user.id, member.workspaceId, meta)
    await this.signedIn(user, member.workspaceId, meta, id)
    return { user: toSessionUser(toActor(user, member, await this.permissionsOf(user.id, member)), memberships), token }
  }

  async createSession(userId: string, workspaceId: string, meta: ClientMeta, tx: DbOrTx = this.db, opts: { pending?: boolean } = {}): Promise<string> {
    return (await this.createSessionRow(userId, workspaceId, meta, tx, opts)).token
  }

  private async createSessionRow(
    userId: string,
    workspaceId: string,
    meta: ClientMeta,
    tx: DbOrTx = this.db,
    opts: { pending?: boolean; assurance?: Assurance; authenticatedAt?: Date } = {},
  ) {
    const token = randomToken()
    const id = newId("ses")
    await tx.insert(sessions).values({
      id,
      userId,
      workspaceId,
      tokenHash: sha256(token),
      userAgent: meta.userAgent?.slice(0, 300) ?? null,
      ip: meta.ip,
      assurance: opts.pending ? "pending" : (opts.assurance ?? "password"),
      authenticatedAt: opts.authenticatedAt,
      expiresAt: new Date(Date.now() + (opts.pending ? PENDING_SESSION_MS : this.operator.sessionDays() * DAY)),
    })
    return { token, id }
  }

  /** Resolves a session cookie to the signed-in member, sliding the expiry. */
  async authenticate(token: string): Promise<{ actor: Actor; session: SessionContext } | null> {
    if (!token || token.length > 200) return null
    const now = new Date()
    const [row] = await this.db
      .select({ session: sessions, user: users })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.tokenHash, sha256(token)), isNull(sessions.revokedAt), gt(sessions.expiresAt, now)))
    if (!row || row.user.disabledAt) return null
    const support = await this.supportView(row.session, row.user, now)
    if (support) return support
    let member = row.session.workspaceId ? await this.activeMember(row.session.workspaceId, row.user.id) : undefined
    if (!member) {
      // Removed from (or suspended out of) the session's workspace: move to another one, if any.
      const [next] = await this.workspaces.membershipsOf(row.user.id)
      if (!next) return null
      member = await this.activeMember(next.id, row.user.id)
      if (!member) return null
      await this.db.update(sessions).set({ workspaceId: next.id }).where(eq(sessions.id, row.session.id))
    }
    const pending = row.session.assurance === "pending"
    // A session still waiting for its code keeps its short expiry.
    if (!pending && now.getTime() - row.session.lastSeenAt.getTime() > TOUCH_EVERY_MS) {
      await this.db
        .update(sessions)
        .set({ lastSeenAt: now, expiresAt: new Date(now.getTime() + this.operator.sessionDays() * DAY) })
        .where(eq(sessions.id, row.session.id))
      await this.db.update(users).set({ lastActiveAt: now }).where(eq(users.id, row.user.id))
      await this.db
        .update(workspaceMembers)
        .set({ lastActiveAt: now })
        .where(and(eq(workspaceMembers.workspaceId, member.workspaceId), eq(workspaceMembers.userId, row.user.id)))
    }
    return {
      actor: toActor(row.user, member, await this.permissionsOf(row.user.id, member)),
      session: { id: row.session.id, assurance: row.session.assurance as Assurance, authenticatedAt: row.session.authenticatedAt, readOnly: false },
    }
  }

  /**
   * A super admin's session in support view: it acts in the company being viewed, with read permissions
   * only, until the view expires (then the session is back to normal). Anyone else's support fields are
   * ignored and cleared.
   */
  private async supportView(session: SessionRow, user: UserRow, now: Date): Promise<{ actor: Actor; session: SessionContext } | null> {
    if (!session.supportWorkspaceId) return null
    const live = session.supportExpiresAt && session.supportExpiresAt > now && user.platformRole === "super_admin" && session.assurance === "mfa"
    if (!live) {
      await this.endSupport(session.id)
      return null
    }
    const actor: Actor = {
      id: user.id,
      name: user.name,
      email: user.email,
      workspaceId: session.supportWorkspaceId,
      role: "viewer",
      productIds: null,
      permissions: SUPPORT_PERMISSIONS,
      mfaEnabled: user.totpEnabledAt !== null,
      platformRole: "super_admin",
      createdAt: user.createdAt,
      support: { reason: session.supportReason ?? "", expiresAt: session.supportExpiresAt! },
    }
    return { actor, session: { id: session.id, assurance: "mfa", authenticatedAt: session.authenticatedAt, readOnly: true } }
  }

  /** Ends a support view: the session goes back to the super admin's own workspace. */
  async endSupport(sessionId: string) {
    await this.db.update(sessions).set({ supportWorkspaceId: null, supportReason: null, supportExpiresAt: null }).where(eq(sessions.id, sessionId))
  }

  /** An enabled membership in an active workspace. */
  private async activeMember(workspaceId: string, userId: string): Promise<Membership | undefined> {
    const [m] = await this.db
      .select({ workspaceId: workspaceMembers.workspaceId, role: workspaceMembers.role, productIds: workspaceMembers.productIds })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.userId, userId),
          isNull(workspaceMembers.disabledAt),
          eq(workspaces.status, "active"),
        ),
      )
    return m
  }

  /**
   * The member as an actor in one workspace, for credentials that aren't a browser session (AI app
   * connections). Null when the account is disabled, the membership is gone or turned off, or the
   * workspace is suspended. Permissions go through the resolver, the same as for sessions, so a role
   * change applies on the next request.
   */
  async memberActor(userId: string, workspaceId: string): Promise<Actor | null> {
    const [user] = await this.db.select().from(users).where(eq(users.id, userId))
    if (!user || user.disabledAt) return null
    const member = await this.activeMember(workspaceId, userId)
    if (!member) return null
    return toActor(user, member, await this.permissionsOf(userId, member))
  }

  /** Moves this session to another workspace the member belongs to. */
  async switchWorkspace(actor: Actor, sessionId: string, workspaceId: string): Promise<SessionUser> {
    const member = await this.activeMember(workspaceId, actor.id)
    if (!member) throw notFound("Workspace")
    await this.db.update(sessions).set({ workspaceId }).where(eq(sessions.id, sessionId))
    await this.db
      .update(workspaceMembers)
      .set({ lastActiveAt: new Date() })
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, actor.id)))
    return this.sessionUser({
      ...actor,
      workspaceId,
      role: member.role as Role,
      productIds: member.productIds ?? null,
      permissions: await this.permissionsOf(actor.id, member),
    })
  }

  /** Records something the person did to their own account, in the workspace they're signed in to. */
  async recordForAccount(actor: Actor, action: string, target: string, meta: ClientMeta) {
    await this.audit.record({ workspaceId: actor.workspaceId, actorId: actor.id, actorName: actor.name, ip: meta.ip }, action, target)
  }

  async logout(sessionId: string) {
    await this.db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, sessionId))
  }

  async updateProfile(actor: Actor, name: string): Promise<SessionUser> {
    await this.db.update(users).set({ name, updatedAt: new Date() }).where(eq(users.id, actor.id))
    return this.sessionUser({ ...actor, name })
  }

  async changePassword(actor: Actor, sessionId: string, current: string, next: string, meta: ClientMeta) {
    const [user] = await this.db.select().from(users).where(eq(users.id, actor.id))
    if (!user || !(await verifyPassword(current, user.passwordHash))) {
      throw unauthenticatedField("currentPassword", "Current password is incorrect")
    }
    await this.db.update(users).set({ passwordHash: await this.hash(next), updatedAt: new Date() }).where(eq(users.id, actor.id))
    await this.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.userId, actor.id), ne(sessions.id, sessionId), isNull(sessions.revokedAt)))
    await forgetTrustedBrowsers(this.db, actor.id)
    await this.audit.record({ workspaceId: actor.workspaceId, actorId: actor.id, actorName: actor.name, ip: meta.ip }, "Changed password", actor.email)
    await this.sendMail(user.email, "Your password was changed", [
      `The password for ${user.email} was just changed. Other sessions were signed out, and trusted browsers will ask for your authenticator code again.`,
      "If this wasn't you, reset your password right away.",
    ])
  }

  async listSessions(actor: Actor, currentId: string): Promise<SessionInfo[]> {
    const rows = await this.db
      .select()
      .from(sessions)
      .where(and(eq(sessions.userId, actor.id), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())))
      .orderBy(desc(sessions.lastSeenAt))
    return rows.map((s) => ({
      id: s.id,
      userAgent: s.userAgent,
      ip: s.ip,
      createdAt: s.createdAt.toISOString(),
      lastSeenAt: s.lastSeenAt.toISOString(),
      current: s.id === currentId,
    }))
  }

  async revokeSession(actor: Actor, id: string) {
    const rows = await this.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.id, id), eq(sessions.userId, actor.id)))
      .returning({ id: sessions.id })
    if (!rows.length) throw notFound("Session")
  }

  /** Always succeeds, so the response never reveals whether an account exists. */
  async forgotPassword(email: string) {
    const [user] = await this.db
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = ${email.toLowerCase()}`)
    if (!user) return
    const token = randomToken()
    await this.db.insert(passwordResets).values({
      id: newId("pwr"),
      userId: user.id,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + 60 * 60_000),
    })
    await this.sendMail(
      user.email,
      "Reset your password",
      ["Someone asked to reset the password for this account. The link works for one hour.", "If it wasn't you, ignore this email."],
      { label: "Choose a new password", url: `${this.config.dashboardUrl}/reset-password?token=${token}` },
    )
  }

  async resetPassword(token: string, password: string, meta: ClientMeta) {
    const now = new Date()
    const [reset] = await this.db
      .select()
      .from(passwordResets)
      .where(and(eq(passwordResets.tokenHash, sha256(token)), isNull(passwordResets.usedAt), gt(passwordResets.expiresAt, now)))
    if (!reset) throw gone("This reset link has expired or was already used. Ask for a new one.")
    const passwordHash = await this.hash(password)
    await this.db.transaction(async (tx) => {
      await tx.update(passwordResets).set({ usedAt: now }).where(eq(passwordResets.id, reset.id))
      await tx.update(users).set({ passwordHash, updatedAt: now }).where(eq(users.id, reset.userId))
      await tx.update(sessions).set({ revokedAt: now }).where(and(eq(sessions.userId, reset.userId), isNull(sessions.revokedAt)))
      await forgetTrustedBrowsers(tx, reset.userId)
    })
    const [user] = await this.db.select().from(users).where(eq(users.id, reset.userId))
    // The account belongs to every workspace the person is in: each one's audit log hears about it.
    for (const w of await this.workspaces.membershipsOf(user.id)) {
      await this.audit.record({ workspaceId: w.id, actorId: user.id, actorName: user.name, ip: meta.ip }, "Reset password", user.email)
    }
  }

  private async findInvite(token: string, tx: DbOrTx = this.db) {
    const [invite] = await tx.select().from(invites).where(eq(invites.tokenHash, sha256(token)))
    if (!invite || invite.revokedAt) throw notFound("Invite")
    if (invite.acceptedAt) throw gone("This invite was already used. Sign in instead.")
    if (invite.expiresAt.getTime() < Date.now()) throw gone("This invite has expired. Ask for a new one.")
    return invite
  }

  async invitePreview(token: string): Promise<InvitePreview> {
    const invite = await this.findInvite(token)
    const s = await this.settings.get(invite.workspaceId)
    const [existing] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.email}) = ${invite.email.toLowerCase()}`)
    return {
      email: invite.email,
      role: invite.role as Role,
      invitedBy: invite.invitedByName,
      companyName: s.companyName,
      platformName: s.platformName,
      existingAccount: Boolean(existing),
    }
  }

  /** Accepting an invite by creating a new account. */
  async acceptInvite(token: string, input: { name: string; password: string }, meta: ClientMeta) {
    const passwordHash = await this.hash(input.password)
    const { user, member, invite } = await this.db.transaction(async (tx) => {
      const invite = await this.findInvite(token, tx)
      const [existing] = await tx
        .select({ id: users.id })
        .from(users)
        .where(sql`lower(${users.email}) = ${invite.email.toLowerCase()}`)
      if (existing) {
        throw new ApiException(409, "This email already has an account. Enter its password to join.", { code: "account_exists" })
      }
      const [row] = await tx
        .insert(users)
        .values({ id: newId("usr"), email: invite.email, name: input.name, passwordHash, lastActiveAt: new Date() })
        .returning()
      const member = await this.joinFromInvite(row, invite, meta, tx)
      return { user: row, member, invite }
    })
    return this.afterJoin(user, member, invite.workspaceId, meta)
  }

  /** Accepting an invite with an account that already exists (it may belong to other workspaces). */
  async joinInvite(token: string, password: string, meta: ClientMeta) {
    const invite = await this.findInvite(token)
    const [user] = await this.db
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = ${invite.email.toLowerCase()}`)
    if (!user) {
      await verifyPassword(password, await dummyHash(this.operator.passwordCost()))
      throw new ApiException(409, "There's no account for this email yet. Create one instead.", { code: "no_account" })
    }
    if (!(await verifyPassword(password, user.passwordHash))) throw unauthenticatedField("password", "That password doesn't match this account")
    if (user.disabledAt) throw new ApiException(403, "This account is disabled. Contact YaroPay support.", { code: "account_disabled" })
    const member = await this.db.transaction(async (tx) => {
      const fresh = await this.findInvite(token, tx)
      return this.joinFromInvite(user, fresh, meta, tx)
    })
    return this.afterJoin(user, member, invite.workspaceId, meta)
  }

  private async joinFromInvite(user: UserRow, invite: typeof invites.$inferSelect, meta: ClientMeta, tx: DbOrTx) {
    // Someone removed earlier and invited back gets their membership re-enabled with the new role.
    const member = await this.workspaces.addMember({ workspaceId: invite.workspaceId, userId: user.id, role: invite.role as Role, productIds: invite.productIds }, tx)
    await tx.update(invites).set({ acceptedAt: new Date() }).where(eq(invites.id, invite.id))
    await this.audit.record({ workspaceId: invite.workspaceId, actorId: user.id, actorName: user.name, ip: meta.ip }, "Joined the team", `${user.email} as ${invite.role}`, tx)
    return member
  }

  private async afterJoin(user: UserRow, member: Membership, workspaceId: string, meta: ClientMeta) {
    const pending = user.totpEnabledAt !== null
    const sessionToken = await this.createSession(user.id, workspaceId, meta, this.db, { pending })
    await this.notifications.notify({
      workspaceId,
      type: "team.member_joined",
      excludeUserId: user.id,
      title: `${user.name} joined the team`,
      body: `${user.email} accepted the invite and joined as ${member.role}.`,
      link: "/settings?tab=team",
    })
    // An existing account with two-step sign-in still owes its code before the session works.
    if (pending) return { mfaRequired: true as const, token: sessionToken }
    return { user: await this.sessionUser(toActor(user, member, await this.permissionsOf(user.id, member))), token: sessionToken }
  }

  /** Emails one person from the install (queued, so it survives a restart). */
  async sendMail(to: string, heading: string, lines: string[], action?: { label: string; url: string }) {
    const s = await this.settings.install()
    const mail = renderEmail({ platform: s.platformName, heading, lines, action })
    await this.jobs.enqueue("email", { to, subject: `[${s.platformName}] ${heading}`, ...mail })
  }
}

function unauthenticatedField(field: string, message: string) {
  const e = unauthenticated(message)
  ;(e.getResponse() as { error: { fields?: Record<string, string> } }).error.fields = { [field]: message }
  return e
}

/** "Chrome on macOS" style description of a user agent. */
export function describeAgent(ua: string | null): string {
  if (!ua) return "an unknown device"
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Chrome\//.test(ua)
      ? "Chrome"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Safari\//.test(ua)
          ? "Safari"
          : /curl|node|python|axios|okhttp/i.test(ua)
            ? "an API client"
            : "a browser"
  const os = /Windows/.test(ua)
    ? "Windows"
    : /Mac OS X|Macintosh/.test(ua)
      ? "macOS"
      : /Android/.test(ua)
        ? "Android"
        : /iPhone|iPad/.test(ua)
          ? "iOS"
          : /Linux/.test(ua)
            ? "Linux"
            : null
  return os ? `${browser} on ${os}` : browser
}
