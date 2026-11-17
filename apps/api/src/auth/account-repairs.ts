import { and, eq, isNull, sql } from "drizzle-orm"
import { newId } from "../common/crypto.js"
import type { Db } from "../database/db.js"
import { auditLog, sessions, users, workspaceMembers } from "../database/schema.js"
import { forgetTrustedBrowsers } from "./trusted-browsers.js"

export type ResetTwoStepResult = { kind: "no_account" } | { kind: "already_off"; email: string } | { kind: "reset"; email: string }

/**
 * Turns off two-step sign-in for someone who lost both their phone and their recovery codes, signs
 * them out everywhere and forgets their trusted browsers. Only reachable from the server (src/cli/accounts.ts). Every workspace they belong
 * to records it in its audit log.
 */
export async function resetTwoStep(db: Db, email: string, actorName = "Server operator"): Promise<ResetTwoStepResult> {
  const [user] = await db.select().from(users).where(sql`lower(${users.email}) = ${email.toLowerCase()}`)
  if (!user) return { kind: "no_account" }
  if (!user.totpEnabledAt) return { kind: "already_off", email: user.email }
  const now = new Date()
  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ totpSecretEnc: null, totpPendingSecretEnc: null, totpEnabledAt: null, totpLastStep: null, recoveryCodeHashes: [], updatedAt: now })
      .where(eq(users.id, user.id))
    await tx.update(sessions).set({ revokedAt: now }).where(and(eq(sessions.userId, user.id), isNull(sessions.revokedAt)))
    await forgetTrustedBrowsers(tx, user.id)
    const memberships = await tx.select({ workspaceId: workspaceMembers.workspaceId }).from(workspaceMembers).where(eq(workspaceMembers.userId, user.id))
    for (const m of memberships) {
      await tx.insert(auditLog).values({
        id: newId("aud"),
        workspaceId: m.workspaceId,
        actorId: null,
        actorName,
        action: "Turned off two-step sign-in",
        target: user.email,
        ip: null,
      })
    }
  })
  return { kind: "reset", email: user.email }
}

export type PlatformRoleResult = { kind: "no_account" } | { kind: "unchanged"; email: string } | { kind: "changed"; email: string }

/**
 * Makes an account a YaroPay Cloud super admin, or takes it away. Only the server's CLI can do this; the
 * console itself never grants the role. Removing it signs the account out so the console closes at once.
 */
export async function setPlatformRole(db: Db, email: string, role: "super_admin" | null): Promise<PlatformRoleResult> {
  const [user] = await db.select().from(users).where(sql`lower(${users.email}) = ${email.toLowerCase()}`)
  if (!user) return { kind: "no_account" }
  if ((user.platformRole ?? null) === role) return { kind: "unchanged", email: user.email }
  const now = new Date()
  await db.transaction(async (tx) => {
    await tx.update(users).set({ platformRole: role, updatedAt: now }).where(eq(users.id, user.id))
    if (role === null) await tx.update(sessions).set({ revokedAt: now }).where(and(eq(sessions.userId, user.id), isNull(sessions.revokedAt)))
  })
  return { kind: "changed", email: user.email }
}
