import { Inject, Injectable } from "@nestjs/common"
import type { Role, WorkspaceSummary } from "@yaropay/core/auth"
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm"
import { newId } from "../common/crypto.js"
import { DB } from "../database/database.module.js"
import type { Db, DbOrTx } from "../database/db.js"
import { type WorkspaceMemberRow, type WorkspaceRow, workspaceMembers, workspaces } from "../database/schema.js"

function slugify(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40) || "company"
}

/** Companies on this install and who belongs to them. */
@Injectable()
export class WorkspacesService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async get(id: string, tx: DbOrTx = this.db): Promise<WorkspaceRow | undefined> {
    const [row] = await tx.select().from(workspaces).where(eq(workspaces.id, id))
    return row
  }

  async count(tx: DbOrTx = this.db): Promise<number> {
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(workspaces)
    return n
  }

  /** Creates a workspace with a unique slug. Edition limits are checked by the caller. */
  async create(input: { name: string; defaultCurrency?: string }, tx: DbOrTx = this.db): Promise<WorkspaceRow> {
    const base = slugify(input.name)
    let slug = base
    for (let i = 2; (await tx.select({ id: workspaces.id }).from(workspaces).where(sql`lower(${workspaces.slug}) = ${slug}`)).length; i++) slug = `${base}-${i}`
    const [row] = await tx
      .insert(workspaces)
      .values({ id: newId("wsp"), name: input.name, slug, ...(input.defaultCurrency ? { defaultCurrency: input.defaultCurrency } : {}) })
      .returning()
    return row
  }

  /** A workspace that exists but has nobody in it: an install migrated before its owner was created. */
  async unclaimed(tx: DbOrTx = this.db): Promise<WorkspaceRow | undefined> {
    const [row] = await tx
      .select({ w: workspaces })
      .from(workspaces)
      .leftJoin(workspaceMembers, eq(workspaceMembers.workspaceId, workspaces.id))
      .where(isNull(workspaceMembers.userId))
      .orderBy(asc(workspaces.createdAt))
      .limit(1)
    return row?.w
  }

  async member(workspaceId: string, userId: string, tx: DbOrTx = this.db): Promise<WorkspaceMemberRow | undefined> {
    const [row] = await tx
      .select()
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
    return row
  }

  async addMember(
    input: { workspaceId: string; userId: string; role: Role; productIds: string[] | null },
    tx: DbOrTx = this.db,
  ): Promise<WorkspaceMemberRow> {
    const [row] = await tx
      .insert(workspaceMembers)
      .values({ ...input, lastActiveAt: new Date() })
      .onConflictDoUpdate({
        target: [workspaceMembers.workspaceId, workspaceMembers.userId],
        set: { role: input.role, productIds: input.productIds, disabledAt: null, lastActiveAt: new Date() },
      })
      .returning()
    return row
  }

  /** Active memberships in active workspaces, most recently used first. */
  async membershipsOf(userId: string, tx: DbOrTx = this.db): Promise<(WorkspaceSummary & { lastActiveAt: Date | null })[]> {
    const rows = await tx
      .select({ id: workspaces.id, name: workspaces.name, role: workspaceMembers.role, lastActiveAt: workspaceMembers.lastActiveAt })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
      .where(and(eq(workspaceMembers.userId, userId), isNull(workspaceMembers.disabledAt), eq(workspaces.status, "active")))
      .orderBy(sql`${workspaceMembers.lastActiveAt} desc nulls last`, desc(workspaceMembers.createdAt))
    return rows.map((r) => ({ ...r, role: r.role as Role }))
  }

  /** Whether the person still belongs to a company that is suspended (to explain a refused sign-in). */
  async hasSuspendedMembership(userId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: workspaces.id })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
      .where(and(eq(workspaceMembers.userId, userId), isNull(workspaceMembers.disabledAt), eq(workspaces.status, "suspended")))
      .limit(1)
    return Boolean(row)
  }
}
