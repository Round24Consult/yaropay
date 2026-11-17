import { sql } from "drizzle-orm"
import type { AppConfig } from "../config/config.js"
import { type Db, rowsOf } from "../database/db.js"
import { decryptWithKeys, encrypt } from "./crypto.js"

/** Every column that holds something encrypted with YAROPAY_ENCRYPTION_KEY. */
export const ENCRYPTED_COLUMNS = [
  { table: "connections", id: "id", column: "credentials_enc" },
  { table: "products", id: "id", column: "signing_secret_enc" },
  { table: "workspaces", id: "id", column: "alerts_webhook_url_enc" },
  { table: "settings", id: "id", column: "alerts_webhook_url_enc" },
  { table: "settings", id: "id", column: "billing_paystack_secret_key_enc" },
  { table: "settings", id: "id", column: "smtp_url_enc" },
  { table: "users", id: "id", column: "totp_secret_enc" },
  { table: "users", id: "id", column: "totp_pending_secret_enc" },
  { table: "billing_payment_methods", id: "workspace_id", column: "authorization_enc" },
] as const

export interface RotationResult {
  table: string
  column: string
  rewritten: number
  /** Values none of the configured keys can read (left untouched). */
  unreadable: number
}

/**
 * Re-encrypts every secret with the current key, reading old values with the current or a previous
 * key. Safe to run more than once and while the app is running: each row is only replaced if it still
 * holds the value that was read.
 */
export async function reencryptAll(db: Db, config: Pick<AppConfig, "encryptionKey" | "previousEncryptionKeys">): Promise<RotationResult[]> {
  const keys = [config.encryptionKey, ...config.previousEncryptionKeys]
  const results: RotationResult[] = []
  for (const target of ENCRYPTED_COLUMNS) {
    const table = sql.identifier(target.table)
    const id = sql.identifier(target.id)
    const column = sql.identifier(target.column)
    const rows = rowsOf<{ id: string | number; value: string }>(await db.execute(sql`select ${id} as id, ${column} as value from ${table} where ${column} is not null`))
    const result: RotationResult = { table: target.table, column: target.column, rewritten: 0, unreadable: 0 }
    for (const row of rows) {
      let plaintext: string
      try {
        plaintext = decryptWithKeys(keys, row.value)
      } catch {
        result.unreadable++
        continue
      }
      await db.execute(sql`update ${table} set ${column} = ${encrypt(config.encryptionKey, plaintext)} where ${id} = ${row.id} and ${column} = ${row.value}`)
      result.rewritten++
    }
    results.push(result)
  }
  return results
}
