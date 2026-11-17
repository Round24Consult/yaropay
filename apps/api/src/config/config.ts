import { GATEWAY_IDS, GATEWAYS } from "@yaropay/core/gateways/registry"
import { gatewayApiBaseUrl } from "@yaropay/core/gateways/types"
import type { GatewayId } from "@yaropay/core/types"
import { z } from "zod"

const bool = (fallback: boolean) =>
  z
    .enum(["true", "false", "1", "0", "on", "off", "yes", "no"])
    .optional()
    .transform((v) => (v === undefined ? fallback : ["true", "1", "on", "yes"].includes(v)))

const env = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default("0.0.0.0"),
  /** Postgres connection string. Leave empty to use the embedded PGlite database in PGLITE_DIR. */
  DATABASE_URL: z.string().optional(),
  /** Embedded database folder, or `memory://` for a throwaway in-memory database. */
  PGLITE_DIR: z.string().default(".data/pglite"),
  /** Runs pending migrations on start. */
  DB_MIGRATE_ON_START: z.string().optional(),
  /** 32 random bytes, base64. `openssl rand -base64 32`. Required in production. */
  YAROPAY_ENCRYPTION_KEY: z.string().optional(),
  /** The key being replaced, while rotating (comma-separated if more than one): still read, never written. */
  YAROPAY_ENCRYPTION_KEY_PREVIOUS: z.string().optional(),
  /** Where the dashboard lives. Used for CORS and for links in emails. */
  DASHBOARD_URL: z.string().url().default("http://localhost:3000"),
  /** Extra origins allowed to call /api with cookies, comma separated. */
  CORS_ORIGINS: z.string().optional(),
  /** Public base URL suggested at first-run setup. Editable later in Settings. */
  YAROPAY_BASE_URL: z.string().url().optional(),
  /** smtp://user:pass@host:587 or smtps://... Leave empty to log emails instead of sending them. */
  SMTP_URL: z.string().optional(),
  /** When set, creating the first (owner) account requires this value. Use it on any install reachable from the internet. */
  SETUP_TOKEN: z.string().optional(),
  MAIL_FROM: z.string().default("YaroPay <no-reply@yaropay.local>"),
  COOKIE_SECURE: z.enum(["auto", "true", "false"]).default("auto"),
  /** Express `trust proxy` setting. */
  TRUST_PROXY: z.string().default("loopback"),
  /** Background workers (webhook deliveries, emails, alerts). */
  WORKERS: z.string().optional(),
  WORKER_INTERVAL_MS: z.coerce.number().int().min(200).default(2000),
  /** Allow forwarding events to private network addresses (localhost, 10.x, 192.168.x...). */
  WEBHOOK_ALLOW_PRIVATE: z.string().optional(),
  WEBHOOK_TIMEOUT_MS: z.coerce.number().int().min(500).max(60_000).default(10_000),
  /** `fast` lowers the password hashing cost; only honoured outside production. */
  PASSWORD_HASH_COST: z.enum(["standard", "fast"]).default("standard"),
  SESSION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  /** Per-IP rate limits on sign-in and other sensitive endpoints. */
  RATE_LIMIT: z.string().optional(),
  /** Product API requests one company may make per minute, across all its products and keys. */
  V1_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(1200),
  GATEWAY_TIMEOUT_MS: z.coerce.number().int().min(500).max(60_000).default(15_000),
  LOG_LEVEL: z.enum(["error", "warn", "log", "debug", "verbose"]).default("log"),
  /** The hosted edition (app.yaropay.com). Needs the paid build. */
  YAROPAY_CLOUD: z.string().optional(),
  /** Run a paid build as Community, for debugging. */
  YAROPAY_DISABLE_EE: z.string().optional(),
})

export interface AppConfig {
  env: "development" | "production" | "test"
  isProduction: boolean
  port: number
  host: string
  database: { kind: "postgres"; url: string } | { kind: "pglite"; dir: string }
  migrateOnStart: boolean
  encryptionKey: Buffer
  /** Older keys that can still decrypt, during a key rotation. New data always uses encryptionKey. */
  previousEncryptionKeys: Buffer[]
  encryptionKeyIsDevDefault: boolean
  dashboardUrl: string
  corsOrigins: string[]
  defaultBaseUrl: string
  smtpUrl: string | null
  /** Required to create the owner account on a fresh install, when set. */
  setupToken: string | null
  mailFrom: string
  cookieSecure: boolean
  trustProxy: string | boolean | number
  workers: boolean
  workerIntervalMs: number
  webhookAllowPrivate: boolean
  webhookTimeoutMs: number
  passwordCost: "standard" | "fast"
  sessionDays: number
  rateLimit: boolean
  /** Per-company product API limit (requests a minute); applies when rateLimit is on. */
  v1RateLimitPerMinute: number
  gateways: {
    timeoutMs: number
    /** API base URLs operators set with `<ID>_API_URL` (PAYSTACK_API_URL, ...), used instead of the gateway's own. */
    apiUrls: Partial<Record<GatewayId, string>>
    /** Paystack's live API: Cloud billing charges cards through YaroPay's own Paystack account. */
    paystackUrl: string
  }
  logLevel: "error" | "warn" | "log" | "debug" | "verbose"
  /** Run as YaroPay Cloud. Refuses to start without the paid build. */
  cloud: boolean
  /** Ignore the paid build even when it is present. */
  disableEe: boolean
}

/** Development fallback key. Production refuses to start without YAROPAY_ENCRYPTION_KEY. */
// Kept from the project's first name: changing it would make data that existing development installs encrypted with it unreadable.
const DEV_KEY = Buffer.from("payroute-development-only-key!!!", "utf8")

/** `<ID>_API_URL` overrides for every gateway in the registry, e.g. PAYSTACK_API_URL. */
function gatewayApiUrls(source: NodeJS.ProcessEnv): Partial<Record<GatewayId, string>> {
  const out: Partial<Record<GatewayId, string>> = {}
  for (const id of GATEWAY_IDS) {
    const name = `${id.toUpperCase()}_API_URL`
    const value = source[name]?.trim()
    if (!value) continue
    if (!z.url().safeParse(value).success) throw new Error(`${name} must be a URL, for example https://api.example.com`)
    out[id] = value.replace(/\/+$/, "")
  }
  return out
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = env.safeParse(source)
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n")
    throw new Error(`Invalid environment:\n${lines}`)
  }
  const e = parsed.data
  const apiUrls = gatewayApiUrls(source)
  const isProduction = e.NODE_ENV === "production"

  const previousEncryptionKeys = (e.YAROPAY_ENCRYPTION_KEY_PREVIOUS ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean)
    .map((k) => {
      const key = Buffer.from(k, "base64")
      if (key.length !== 32) throw new Error("YAROPAY_ENCRYPTION_KEY_PREVIOUS must be 32-byte keys, base64 encoded")
      return key
    })
  let encryptionKey = DEV_KEY
  let encryptionKeyIsDevDefault = true
  if (e.YAROPAY_ENCRYPTION_KEY) {
    const key = Buffer.from(e.YAROPAY_ENCRYPTION_KEY, "base64")
    if (key.length !== 32) throw new Error("YAROPAY_ENCRYPTION_KEY must be 32 bytes, base64 encoded (openssl rand -base64 32)")
    encryptionKey = key
    encryptionKeyIsDevDefault = false
  } else if (isProduction) {
    throw new Error("YAROPAY_ENCRYPTION_KEY is required in production (openssl rand -base64 32)")
  }

  const setupToken = e.SETUP_TOKEN?.trim() || null
  if (setupToken && setupToken.length < 16) throw new Error("SETUP_TOKEN must be at least 16 characters (openssl rand -hex 24)")

  const trust = e.TRUST_PROXY
  const trustProxy = trust === "true" ? true : trust === "false" ? false : /^\d+$/.test(trust) ? Number(trust) : trust
  const dashboardUrl = e.DASHBOARD_URL.replace(/\/+$/, "")

  return {
    env: e.NODE_ENV,
    isProduction,
    port: e.PORT,
    host: e.HOST,
    database: e.DATABASE_URL ? { kind: "postgres", url: e.DATABASE_URL } : { kind: "pglite", dir: e.PGLITE_DIR },
    migrateOnStart: bool(true).parse(e.DB_MIGRATE_ON_START),
    encryptionKey,
    previousEncryptionKeys,
    encryptionKeyIsDevDefault,
    dashboardUrl,
    corsOrigins: [dashboardUrl, ...(e.CORS_ORIGINS ?? "").split(",").map((s) => s.trim().replace(/\/+$/, ""))].filter(Boolean),
    defaultBaseUrl: (e.YAROPAY_BASE_URL ?? `http://localhost:${e.PORT}`).replace(/\/+$/, ""),
    smtpUrl: e.SMTP_URL || null,
    setupToken,
    mailFrom: e.MAIL_FROM,
    cookieSecure: e.COOKIE_SECURE === "auto" ? isProduction : e.COOKIE_SECURE === "true",
    trustProxy,
    workers: bool(e.NODE_ENV !== "test").parse(e.WORKERS),
    workerIntervalMs: e.WORKER_INTERVAL_MS,
    webhookAllowPrivate: bool(!isProduction).parse(e.WEBHOOK_ALLOW_PRIVATE),
    webhookTimeoutMs: e.WEBHOOK_TIMEOUT_MS,
    passwordCost: isProduction ? "standard" : e.PASSWORD_HASH_COST,
    sessionDays: e.SESSION_DAYS,
    rateLimit: bool(e.NODE_ENV !== "test").parse(e.RATE_LIMIT),
    v1RateLimitPerMinute: e.V1_RATE_LIMIT_PER_MINUTE,
    gateways: {
      timeoutMs: e.GATEWAY_TIMEOUT_MS,
      apiUrls,
      paystackUrl: apiUrls.paystack ?? gatewayApiBaseUrl(GATEWAYS.paystack, "live"),
    },
    logLevel: e.LOG_LEVEL,
    cloud: bool(false).parse(e.YAROPAY_CLOUD),
    disableEe: bool(false).parse(e.YAROPAY_DISABLE_EE),
  }
}

export const APP_CONFIG = Symbol("APP_CONFIG")
