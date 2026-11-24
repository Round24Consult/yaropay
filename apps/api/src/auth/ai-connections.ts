import { and, eq, isNull } from "drizzle-orm"
import type { DbOrTx } from "../database/db.js"
import { mcpConnections } from "../database/schema.js"

/** Why every AI app of an account was disconnected at once. */
export type AiDisconnectReason = "password_changed" | "password_reset" | "two_step_off" | "two_step_reset" | "account_disabled"

/**
 * Disconnects every AI app (MCP connection and personal token) of an account. Called wherever trusted
 * browsers are forgotten: a changed password or two-step sign-in must also end what an AI app holds.
 * The tables exist in every edition; Community simply has no rows.
 */
export async function disconnectAiApps(db: DbOrTx, userId: string, reason: AiDisconnectReason): Promise<number> {
  const rows = await db
    .update(mcpConnections)
    .set({ revokedAt: new Date(), revokeReason: reason })
    .where(and(eq(mcpConnections.userId, userId), isNull(mcpConnections.revokedAt)))
    .returning({ id: mcpConnections.id })
  return rows.length
}
