import "reflect-metadata"
import { existsSync } from "node:fs"
import { Logger } from "@nestjs/common"
import { createApp } from "./bootstrap.js"
import { loadConfig } from "./config/config.js"
import { loadExtension } from "./extension/load.js"

// Loaded here rather than with `node --env-file`: in watch mode that flag makes
// Node restart on any change in the folder, including the embedded database.
if (existsSync(".env")) process.loadEnvFile(".env")

const config = loadConfig()
const extension = await loadExtension(config)
const app = await createApp(config, { extension })
await app.listen(config.port, config.host)

const log = new Logger("YaroPay")
log.log(`API listening on http://${config.host === "0.0.0.0" ? "localhost" : config.host}:${config.port} (${extension.edition} edition)`)
if (config.encryptionKeyIsDevDefault) {
  log.warn("YAROPAY_ENCRYPTION_KEY is not set: using the development key. Set it before storing real gateway keys.")
}
if (!config.smtpUrl) log.warn("SMTP_URL is not set: emails are printed to this log instead of being sent, unless an email server is saved in the platform console.")
