import { loadConfig } from "../config/config.js"
import { openDatabase } from "../database/db.js"

const config = loadConfig()
const handle = await openDatabase(config)
try {
  await handle.migrate()
  console.log(`Migrations applied (${handle.kind}).`)
} finally {
  await handle.close()
}
