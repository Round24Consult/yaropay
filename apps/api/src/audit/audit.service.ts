import { Inject, Injectable } from "@nestjs/common"
import type { AuditEntry } from "@yaropay/core/types"
import { desc, eq } from "drizzle-orm"
import type { AuditContext } from "../auth/types.js"
import { newId } from "../common/crypto.js"
import { DB } from "../database/database.module.js"
import type { Db, DbOrTx } from "../database/db.js"
import { auditLog } from "../database/schema.js"

@Injectable()
export class AuditService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async record(ctx: AuditContext, action: string, target: string, tx: DbOrTx = this.db) {
    await tx.insert(auditLog).values({
      id: newId("aud"),
      workspaceId: ctx.workspaceId,
      actorId: ctx.actorId,
      actorName: ctx.actorName,
      action,
      target,
      ip: ctx.ip,
    })
  }

  async list(workspaceId: string, limit = 100): Promise<AuditEntry[]> {
    const rows = await this.db.select().from(auditLog).where(eq(auditLog.workspaceId, workspaceId)).orderBy(desc(auditLog.at)).limit(limit)
    return rows.map((r) => ({ id: r.id, actor: r.actorName, action: r.action, target: r.target, ip: r.ip, at: r.at.toISOString() }))
  }
}
