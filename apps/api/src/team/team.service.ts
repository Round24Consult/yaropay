import { Inject, Injectable } from "@nestjs/common"
import {
  canManageRole,
  type CreatedInvite,
  type Invite,
  type InviteInput,
  ROLES,
  type Role,
  type UpdateMemberInput,
} from "@yaropay/core/auth"
import type { TeamMember } from "@yaropay/core/types"
import { and, asc, count, desc, eq, inArray, isNull, sql } from "drizzle-orm"
import { AuditService } from "../audit/audit.service.js"
import type { Actor, AuditContext } from "../auth/types.js"
import { newId, randomToken, sha256 } from "../common/crypto.js"
import { conflict, forbidden, invalid, notFound } from "../common/errors.js"
import { APP_CONFIG, type AppConfig } from "../config/config.js"
import { DB } from "../database/database.module.js"
import type { Db } from "../database/db.js"
import { type InviteRow, invites, products, sessions, type UserRow, users, type WorkspaceMemberRow, workspaceMembers } from "../database/schema.js"
import { JobsService } from "../notifications/jobs.service.js"
import { MailerService, renderEmail } from "../notifications/mailer.service.js"
import { SettingsService } from "../settings/settings.service.js"

const INVITE_DAYS = 7
const roleLabel = (r: string) => ROLES.find((x) => x.value === r)?.label ?? r

function toMember(u: UserRow, m: WorkspaceMemberRow): TeamMember {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: m.role as Role,
    productIds: m.productIds ?? null,
    lastActiveAt: m.lastActiveAt?.toISOString() ?? null,
    createdAt: m.createdAt.toISOString(),
  }
}

function toInvite(i: InviteRow): Invite {
  return {
    id: i.id,
    email: i.email,
    role: i.role as Role,
    productIds: i.productIds ?? null,
    invitedBy: i.invitedByName,
    createdAt: i.createdAt.toISOString(),
    expiresAt: i.expiresAt.toISOString(),
    expired: i.expiresAt.getTime() < Date.now(),
  }
}

@Injectable()
export class TeamService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly audit: AuditService,
    private readonly mailer: MailerService,
    private readonly jobs: JobsService,
    private readonly settings: SettingsService,
  ) {}

  async members(workspaceId: string): Promise<TeamMember[]> {
    const rows = await this.db
      .select({ u: users, m: workspaceMembers })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), isNull(workspaceMembers.disabledAt)))
      .orderBy(asc(workspaceMembers.createdAt))
    return rows.map((r) => toMember(r.u, r.m))
  }

  async invites(workspaceId: string): Promise<Invite[]> {
    const rows = await this.db
      .select()
      .from(invites)
      .where(and(eq(invites.workspaceId, workspaceId), isNull(invites.acceptedAt), isNull(invites.revokedAt)))
      .orderBy(desc(invites.createdAt))
    return rows.map(toInvite)
  }

  /** Product scope must name existing products in the workspace; owners and admins always see everything. */
  private async checkScope(workspaceId: string, role: Role, productIds: string[] | null): Promise<string[] | null> {
    if (role === "owner" || role === "admin" || productIds === null) return null
    const unique = [...new Set(productIds)]
    if (!unique.length) throw invalid({ productIds: "Pick at least one product, or choose All products" })
    const found = await this.db
      .select({ id: products.id })
      .from(products)
      .where(and(eq(products.workspaceId, workspaceId), inArray(products.id, unique)))
    if (found.length !== unique.length) throw invalid({ productIds: "One of the selected products no longer exists" })
    return unique
  }

  async invite(actor: Actor, input: InviteInput, ctx: AuditContext): Promise<CreatedInvite> {
    if (!canManageRole(actor.role, input.role)) throw forbidden(`You can't invite someone as ${roleLabel(input.role)}`)
    const productIds = await this.checkScope(ctx.workspaceId, input.role, input.productIds)
    // People who already have an account elsewhere on the install can be invited; current members can't.
    const [member] = await this.db
      .select({ id: users.id })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(and(eq(workspaceMembers.workspaceId, ctx.workspaceId), sql`lower(${users.email}) = ${input.email}`, isNull(workspaceMembers.disabledAt)))
    if (member) throw invalid({ email: "This person is already on the team" })
    // A newer invite replaces any pending one for the same address.
    await this.db
      .update(invites)
      .set({ revokedAt: new Date() })
      .where(and(eq(invites.workspaceId, ctx.workspaceId), sql`lower(${invites.email}) = ${input.email}`, isNull(invites.acceptedAt), isNull(invites.revokedAt)))
    const token = randomToken()
    const [row] = await this.db
      .insert(invites)
      .values({
        id: newId("inv"),
        workspaceId: ctx.workspaceId,
        email: input.email,
        role: input.role,
        productIds,
        tokenHash: sha256(token),
        invitedById: actor.id,
        invitedByName: actor.name,
        expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000),
      })
      .returning()
    await this.audit.record(ctx, "Invited a team member", `${input.email} as ${roleLabel(input.role)}`)
    return this.deliverInvite(row, token, actor)
  }

  async resend(actor: Actor, id: string, ctx: AuditContext): Promise<CreatedInvite> {
    const [row] = await this.db.select().from(invites).where(and(eq(invites.id, id), eq(invites.workspaceId, ctx.workspaceId)))
    if (!row || row.acceptedAt || row.revokedAt) throw notFound("Invite")
    if (!canManageRole(actor.role, row.role as Role)) throw forbidden()
    const token = randomToken()
    const [next] = await this.db
      .update(invites)
      .set({ tokenHash: sha256(token), expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000), invitedById: actor.id, invitedByName: actor.name })
      .where(eq(invites.id, id))
      .returning()
    await this.audit.record(ctx, "Resent an invite", row.email)
    return this.deliverInvite(next, token, actor)
  }

  async revoke(actor: Actor, id: string, ctx: AuditContext) {
    const [row] = await this.db.select().from(invites).where(and(eq(invites.id, id), eq(invites.workspaceId, ctx.workspaceId)))
    if (!row || row.acceptedAt || row.revokedAt) throw notFound("Invite")
    if (!canManageRole(actor.role, row.role as Role)) throw forbidden()
    await this.db.update(invites).set({ revokedAt: new Date() }).where(eq(invites.id, id))
    await this.audit.record(ctx, "Revoked an invite", row.email)
  }

  private async deliverInvite(row: InviteRow, token: string, actor: Actor): Promise<CreatedInvite> {
    const inviteUrl = `${this.config.dashboardUrl}/invite/${token}`
    const s = await this.settings.get(row.workspaceId)
    const mail = renderEmail({
      platform: s.platformName,
      heading: `Join ${s.companyName} on ${s.platformName}`,
      lines: [
        `${actor.name} invited you to ${s.companyName}'s payments dashboard as ${roleLabel(row.role)}.`,
        `The invite works for ${INVITE_DAYS} days.`,
      ],
      action: { label: "Accept invite", url: inviteUrl },
    })
    await this.jobs.enqueue("email", { to: row.email, subject: `${actor.name} invited you to ${s.platformName}`, ...mail })
    return { invite: toInvite(row), inviteUrl, emailed: this.mailer.enabled }
  }

  private async load(workspaceId: string, id: string): Promise<{ u: UserRow; m: WorkspaceMemberRow }> {
    const [row] = await this.db
      .select({ u: users, m: workspaceMembers })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, id), isNull(workspaceMembers.disabledAt)))
    if (!row) throw notFound("Member")
    return row
  }

  private async ownerCount(workspaceId: string): Promise<number> {
    const [{ n }] = await this.db
      .select({ n: count() })
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.role, "owner"), isNull(workspaceMembers.disabledAt)))
    return n
  }

  async update(actor: Actor, id: string, input: UpdateMemberInput, ctx: AuditContext): Promise<TeamMember> {
    const { u: target, m } = await this.load(ctx.workspaceId, id)
    if (target.id === actor.id && input.role && input.role !== actor.role) throw forbidden("You can't change your own role")
    if (!canManageRole(actor.role, m.role as Role)) throw forbidden(`You can't change a ${roleLabel(m.role)}`)
    const role = (input.role ?? m.role) as Role
    if (input.role && !canManageRole(actor.role, input.role)) throw forbidden(`You can't make someone ${roleLabel(input.role)}`)
    if (m.role === "owner" && role !== "owner" && (await this.ownerCount(ctx.workspaceId)) <= 1) {
      throw conflict("Every workspace needs at least one owner. Make someone else an owner first.")
    }
    const productIds = await this.checkScope(ctx.workspaceId, role, input.productIds !== undefined ? input.productIds : (m.productIds ?? null))
    const [row] = await this.db
      .update(workspaceMembers)
      .set({ role, productIds })
      .where(and(eq(workspaceMembers.workspaceId, ctx.workspaceId), eq(workspaceMembers.userId, id)))
      .returning()
    const scope = productIds ? `${productIds.length} product${productIds.length === 1 ? "" : "s"}` : "all products"
    await this.audit.record(ctx, "Changed member access", `${target.email}: ${roleLabel(role)}, ${scope}`)
    return toMember(target, row)
  }

  async remove(actor: Actor, id: string, ctx: AuditContext) {
    const { u: target, m } = await this.load(ctx.workspaceId, id)
    if (target.id === actor.id) throw forbidden("You can't remove yourself")
    if (!canManageRole(actor.role, m.role as Role)) throw forbidden(`You can't remove a ${roleLabel(m.role)}`)
    if (m.role === "owner" && (await this.ownerCount(ctx.workspaceId)) <= 1) throw conflict("You can't remove the last owner")
    const now = new Date()
    // Removed from this workspace only: the account and its other workspaces stay.
    await this.db
      .update(workspaceMembers)
      .set({ disabledAt: now })
      .where(and(eq(workspaceMembers.workspaceId, ctx.workspaceId), eq(workspaceMembers.userId, id)))
    await this.db
      .update(sessions)
      .set({ revokedAt: now })
      .where(and(eq(sessions.userId, id), eq(sessions.workspaceId, ctx.workspaceId), isNull(sessions.revokedAt)))
    await this.audit.record(ctx, "Removed a team member", target.email)
  }
}
