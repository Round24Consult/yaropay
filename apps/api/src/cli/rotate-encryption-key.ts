import { reencryptAll } from "../common/key-rotation.js"
import { loadConfig } from "../config/config.js"
import { openDatabase } from "../database/db.js"

/**
 * Re-encrypts every stored secret with YAROPAY_ENCRYPTION_KEY, reading old values with
 * YAROPAY_ENCRYPTION_KEY_PREVIOUS. Inside the API container, after setting both and restarting:
 *
 *   node dist/cli/rotate-encryption-key.js
 *
 * Then remove YAROPAY_ENCRYPTION_KEY_PREVIOUS and restart again.
 */
const config = loadConfig()
if (!config.previousEncryptionKeys.length) {
  console.error("Set YAROPAY_ENCRYPTION_KEY_PREVIOUS to the old key (and YAROPAY_ENCRYPTION_KEY to the new one) first.")
  process.exit(2)
}
const handle = await openDatabase(config)
try {
  const results = await reencryptAll(handle.db, config)
  let unreadable = 0
  for (const r of results) {
    unreadable += r.unreadable
    console.log(`${r.table}.${r.column}: ${r.rewritten} re-encrypted${r.unreadable ? `, ${r.unreadable} unreadable with either key` : ""}`)
  }
  if (unreadable) {
    console.error(`${unreadable} value(s) couldn't be read with the current or previous key and were left as they are. Keep the previous key until you know why.`)
    process.exitCode = 1
  } else {
    console.log("Done. Remove YAROPAY_ENCRYPTION_KEY_PREVIOUS and restart.")
  }
} finally {
  await handle.close()
}
