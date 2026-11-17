import { parseArgs } from "node:util"
import { loadConfig } from "../config/config.js"
import { openDatabase } from "../database/db.js"
import { seedDemo } from "../demo/seed.js"

/**
 * npm run db:seed -- [--force] [--webhook-base=http://localhost:4100/hooks]
 *                    [--owner-email=you@company.com --owner-password=... --owner-name="Your Name"]
 */
const { values } = parseArgs({
  options: {
    force: { type: "boolean", default: false },
    "webhook-base": { type: "string" },
    "owner-email": { type: "string" },
    "owner-password": { type: "string" },
    "owner-name": { type: "string", default: "Demo Owner" },
    quiet: { type: "boolean", default: false },
  },
})

/** Owner from flags, or from SEED_OWNER_EMAIL / SEED_OWNER_PASSWORD / SEED_OWNER_NAME. */
function owner() {
  const email = values["owner-email"] ?? process.env.SEED_OWNER_EMAIL
  const password = values["owner-password"] ?? process.env.SEED_OWNER_PASSWORD
  const name = process.env.SEED_OWNER_NAME ?? values["owner-name"]!
  return email && password ? { email, password, name } : undefined
}

const config = loadConfig()
const handle = await openDatabase(config)
try {
  await handle.migrate()
  const keys = await seedDemo(handle.db, config, {
    force: values.force,
    webhookBase: values["webhook-base"] ?? (process.env.DEMO_WEBHOOK_BASE || undefined),
    companyName: process.env.SEED_COMPANY_NAME || undefined,
    owner: owner(),
    log: (line) => console.log(line),
  })
  if (keys && !values.quiet) {
    console.log("\nDemo product keys (shown once):")
    for (const [name, k] of Object.entries(keys)) console.log(`  ${name.padEnd(10)} live ${k.live}\n             test ${k.test}\n             signing secret ${k.signingSecret}`)
  }
} finally {
  await handle.close()
}
