import { Inject, Injectable } from "@nestjs/common"
import { TRUSTED_BROWSER_DAYS, type TrustedBrowser } from "@yaropay/core/auth"
import { and, desc, eq, gt, lte } from "drizzle-orm"
import { newId, randomToken, sha256 } from "../common/crypto.js"
import { notFound } from "../common/errors.js"
import { DB } from "../database/database.module.js"
import type { Db, DbOrTx } from "../database/db.js"
import { trustedBrowsers } from "../database/schema.js"

/** The cookie that remembers a trusted browser. Only sent to /api/auth, never to the rest of the API. */
export const TRUSTED_COOKIE = "yaropay_trusted"
export const TRUSTED_COOKIE_PATH = "/api/auth"
export const TRUSTED_BROWSER_MS = TRUSTED_BROWSER_DAYS * 86_400_000

export interface TrustedBrowserRow {
  id: string
  createdAt: Date
  label: string
}

/**
 * Forgets every browser a person trusted. Called when the password changes or is reset, when two-step
 * sign-in is turned off or reset, and when the account is disabled. A plain function so the server CLI
 * and the paid build can call it inside their own transactions.
 */
export async function forgetTrustedBrowsers(db: DbOrTx, userId: string): Promise<number> {
  const rows = await db.delete(trustedBrowsers).where(eq(trustedBrowsers.userId, userId)).returning({ id: trustedBrowsers.id })
  return rows.length
}

/**
 * "Trust this browser for 30 days" on the two-step sign-in. A trusted browser still has to give the
 * password; it only skips the authenticator code, and only for the account that trusted it. Sensitive
 * actions keep asking for a fresh code.
 */
@Injectable()
export class TrustedBrowsersService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Remembers this browser for the person; returns the token for the cookie (shown nowhere else). */
  async trust(userId: string, label: string): Promise<{ token: string; expiresAt: Date }> {
    const token = randomToken()
    const createdAt = new Date()
    const expiresAt = new Date(createdAt.getTime() + TRUSTED_BROWSER_MS)
    await this.db.insert(trustedBrowsers).values({ id: newId("tbr"), userId, tokenHash: sha256(token), label: label.slice(0, 100), createdAt, expiresAt })
    return { token, expiresAt }
  }

  /**
   * The trusted browser behind a cookie, if it belongs to this person and hasn't expired. Marks it used.
   * Anything else (someone else's, expired, removed, malformed) is null, and the caller clears the cookie.
   */
  async check(token: string | undefined, userId: string): Promise<TrustedBrowserRow | null> {
    if (!token || token.length > 200) return null
    const now = new Date()
    const [row] = await this.db
      .update(trustedBrowsers)
      .set({ lastUsedAt: now })
      .where(and(eq(trustedBrowsers.tokenHash, sha256(token)), eq(trustedBrowsers.userId, userId), gt(trustedBrowsers.expiresAt, now)))
      .returning({ id: trustedBrowsers.id, createdAt: trustedBrowsers.createdAt, label: trustedBrowsers.label })
    return row ?? null
  }

  /** Expired rows serve no purpose; they're cleared whenever their owner signs in. */
  async pruneExpired(userId: string) {
    await this.db.delete(trustedBrowsers).where(and(eq(trustedBrowsers.userId, userId), lte(trustedBrowsers.expiresAt, new Date())))
  }

  async list(userId: string, currentToken: string | undefined): Promise<TrustedBrowser[]> {
    const currentHash = currentToken && currentToken.length <= 200 ? sha256(currentToken) : null
    const rows = await this.db
      .select()
      .from(trustedBrowsers)
      .where(and(eq(trustedBrowsers.userId, userId), gt(trustedBrowsers.expiresAt, new Date())))
      .orderBy(desc(trustedBrowsers.createdAt))
    return rows.map((r) => ({
      id: r.id,
      label: r.label,
      createdAt: r.createdAt.toISOString(),
      lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
      expiresAt: r.expiresAt.toISOString(),
      current: r.tokenHash === currentHash,
    }))
  }

  /** Removes one of the person's trusted browsers; says whether it was the browser making the request. */
  async remove(userId: string, id: string, currentToken: string | undefined): Promise<{ label: string; current: boolean }> {
    const [row] = await this.db
      .delete(trustedBrowsers)
      .where(and(eq(trustedBrowsers.id, id), eq(trustedBrowsers.userId, userId)))
      .returning({ label: trustedBrowsers.label, tokenHash: trustedBrowsers.tokenHash })
    if (!row) throw notFound("Trusted browser")
    return { label: row.label, current: Boolean(currentToken && currentToken.length <= 200 && row.tokenHash === sha256(currentToken)) }
  }

  removeAll(userId: string): Promise<number> {
    return forgetTrustedBrowsers(this.db, userId)
  }
}
