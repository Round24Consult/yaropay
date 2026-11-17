import { z } from "zod"
import { BILLING_CURRENCIES, type BillingCurrency, type BillingStatus, type ExchangeRates, type Invoice, type PricedUsage, type SavedCard, type Usage } from "./billing.ts"
import type { Role } from "./auth.ts"
import type { CurrencyCode } from "./types.ts"

/**
 * The YaroPay Cloud platform console: what the super admin sees across every company. The routes live
 * in the paid build (/api/platform/*) and answer 404 to everyone else.
 */

export type WorkspaceStatus = "active" | "suspended"

export interface PlatformOverview {
  workspaces: { total: number; active: number; suspended: number; trialing: number; newLast30Days: number }
  /** Products that took a live payment this month, across all companies (trial and free months included). */
  liveProducts: number
  /** Successful live payments this month, per currency. */
  volume: { currency: CurrencyCode; amount: number; count: number }[]
  /** What this month would bill so far, per billing currency (after trials and free months). */
  estimatedRevenue: Record<BillingCurrency, number>
  failedDeliveries24h: number
  unroutedEvents24h: number
  /** Currencies with live volume but no exchange rate: those amounts aren't counted in volume fees. */
  missingRates: CurrencyCode[]
}

export interface PlatformWorkspaceRow {
  id: string
  name: string
  slug: string
  status: WorkspaceStatus
  plan: string
  planName: string | null
  billingCurrency: BillingCurrency
  ownerEmail: string | null
  members: number
  liveProducts: number
  /** This month so far, in the billing currency. */
  estimate: number
  trialEndsAt: string | null
  /** Trial days that start with the first live payment (set at sign-up). */
  pendingTrialDays: number | null
  billingStatus: BillingStatus
  freeUntil: string | null
  createdAt: string
  lastActiveAt: string | null
}

export interface PlatformWorkspaceList {
  rows: PlatformWorkspaceRow[]
  total: number
}

export interface PlatformAuditEntry {
  id: string
  actorEmail: string
  action: string
  targetType: string
  targetId: string | null
  workspaceId: string | null
  detail: Record<string, unknown>
  ip: string | null
  at: string
}

export interface PlatformWorkspaceDetail extends PlatformWorkspaceRow {
  suspendedAt: string | null
  suspendedReason: string | null
  team: { id: string; name: string; email: string; role: Role; mfaEnabled: boolean; disabled: boolean; lastActiveAt: string | null }[]
  products: { id: string; name: string; status: string; sample: boolean; liveThisMonth: boolean }[]
  gateways: { gatewayId: string; mode: string; count: number }[]
  health: { failedDeliveries7d: number; unroutedEvents7d: number }
  /** This month: what was used, and what it costs so far (after trial and free months). */
  usage: Usage
  priced: PricedUsage | null
  invoices: Invoice[]
  card: SavedCard | null
  /** Invites sent but not yet accepted. */
  invites: PlatformInvite[]
  audit: PlatformAuditEntry[]
}

export interface ExchangeRateRow {
  currency: CurrencyCode
  nairaPerUnit: string
  updatedAt: string
}

export interface PlatformRates {
  rates: ExchangeRates
  rows: ExchangeRateRow[]
}

export const suspendWorkspaceSchema = z.object({ reason: z.string().trim().min(3, "Say why, for the record").max(300) })

/** Why the support view is needed; the company's owners see it. */
export const supportViewSchema = z.object({ reason: z.string().trim().min(5, "Say why, for the company and the record").max(300) })

const isoDate = z.iso.datetime({ offset: true }).nullable()

export const workspaceBillingSchema = z
  .object({
    plan: z.string().trim().min(1).max(40).optional(),
    billingCurrency: z.enum(BILLING_CURRENCIES).optional(),
    /** End of the free trial (null clears it). */
    trialEndsAt: isoDate.optional(),
    /** Free until this moment (null clears it). */
    freeUntil: isoDate.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Nothing to update")

export const platformWorkspacesQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(["active", "suspended", "trialing"]).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
})

export type WorkspaceBillingInput = z.infer<typeof workspaceBillingSchema>

/** Platform-wide Cloud settings. */
export interface PlatformSettings {
  /** Anyone can create a company from the sign-up page. */
  signupsOpen: boolean
  /** The plan new companies start on. */
  signupPlan: string
}

export const platformSettingsSchema = z
  .object({ signupsOpen: z.boolean().optional(), signupPlan: z.string().trim().min(1).max(40).optional() })
  .refine((v) => Object.keys(v).length > 0, "Nothing to update")

// ---- Operator settings (Platform → Settings) ----

/**
 * Server settings the super admin can change from the console instead of the server's .env. A value
 * saved in the console wins over the env value; clearing it goes back to the env value. Everything
 * security-critical (encryption key, database, setup token, edition) stays env-only.
 */
export const OPERATOR_SETTINGS = [
  "billingPaystackSecretKey",
  "smtpUrl",
  "mailFrom",
  "v1RateLimitPerMinute",
  "gatewayTimeoutMs",
  "webhookTimeoutMs",
  "sessionDays",
  "passwordHashCost",
  "logLevel",
  "workerIntervalMs",
] as const
export type OperatorSettingKey = (typeof OPERATOR_SETTINGS)[number]

/** How Platform → Settings groups the cards, in this order. */
export const OPERATOR_SETTING_GROUPS = [
  { id: "billing", label: "Billing" },
  { id: "email", label: "Email" },
  { id: "limits", label: "Limits & timeouts" },
  { id: "sessions", label: "Sessions & security" },
  { id: "logging", label: "Logging & workers" },
] as const
export type OperatorSettingGroup = (typeof OPERATOR_SETTING_GROUPS)[number]["id"]

/** The API's log levels, quietest first: each level includes the ones before it. */
export const LOG_LEVELS = ["error", "warn", "log", "debug", "verbose"] as const
export type LogLevel = (typeof LOG_LEVELS)[number]

/** Password hashing cost. "fast" is for development and tests: production always uses "standard". */
export const PASSWORD_HASH_COSTS = ["standard", "fast"] as const
export type PasswordHashCost = (typeof PASSWORD_HASH_COSTS)[number]

export interface OperatorSettingInfo {
  label: string
  description: string
  /** The env variable it overrides. */
  env: string
  /** Secrets are write-only: the API only ever returns their last 4 characters. */
  secret: boolean
  group: OperatorSettingGroup
  /** For numbers: the unit the value is in, shown next to it. */
  unit?: string
  /** For a choice: the values allowed, shown as a list. */
  options?: readonly string[]
  /** When a change takes effect, if that needs saying. */
  note?: string
}

export const OPERATOR_SETTING_INFO: Record<OperatorSettingKey, OperatorSettingInfo> = {
  billingPaystackSecretKey: {
    label: "Billing Paystack secret key",
    description: "YaroPay's own Paystack account, used to charge companies' saved cards for their invoices. Without it, card payments are off.",
    env: "BILLING_PAYSTACK_SECRET_KEY",
    secret: true,
    group: "billing",
  },
  smtpUrl: {
    label: "Email server (SMTP URL)",
    description: "Where YaroPay sends email: invites, password resets, invoices and alerts. Without it, emails are only written to the server log.",
    env: "SMTP_URL",
    secret: true,
    group: "email",
  },
  mailFrom: {
    label: "Email sender",
    description: 'The From address on every email, for example "YaroPay <no-reply@yaropay.com>".',
    env: "MAIL_FROM",
    secret: false,
    group: "email",
  },
  v1RateLimitPerMinute: {
    label: "Product API limit per company",
    description: "Product API requests one company can make each minute, across all its products and keys. Over it, requests get 429.",
    env: "V1_RATE_LIMIT_PER_MINUTE",
    secret: false,
    group: "limits",
    unit: "requests a minute",
  },
  gatewayTimeoutMs: {
    label: "Gateway timeout",
    description: "How long YaroPay waits for a payment gateway's API (and Cloud billing's calls to Paystack) before giving up.",
    env: "GATEWAY_TIMEOUT_MS",
    secret: false,
    group: "limits",
    unit: "ms",
    note: "Applies from the next call to a gateway.",
  },
  webhookTimeoutMs: {
    label: "Webhook timeout",
    description: "How long YaroPay waits for a product's webhook endpoint, and for alert webhooks, before counting the attempt as failed.",
    env: "WEBHOOK_TIMEOUT_MS",
    secret: false,
    group: "limits",
    unit: "ms",
    note: "Applies from the next delivery.",
  },
  sessionDays: {
    label: "Sign-in length",
    description: "How long a sign-in lasts without activity.",
    env: "SESSION_DAYS",
    secret: false,
    group: "sessions",
    unit: "days",
    note: "Applies to new sign-ins, and to existing ones the next time they're renewed during use. Until then a sign-in keeps the expiry it has.",
  },
  passwordHashCost: {
    label: "Password hashing cost",
    description: "How much work goes into storing each password. Production always uses standard; fast is for development and tests only.",
    env: "PASSWORD_HASH_COST",
    secret: false,
    group: "sessions",
    options: PASSWORD_HASH_COSTS,
    note: "Applies to passwords set from now on. Existing passwords keep working with the cost they were saved with.",
  },
  logLevel: {
    label: "Log level",
    description: "How much the API writes to its log. Each level includes the ones before it: error, warn, log, debug, verbose.",
    env: "LOG_LEVEL",
    secret: false,
    group: "logging",
    options: LOG_LEVELS,
    note: "Applies at once.",
  },
  workerIntervalMs: {
    label: "Worker interval",
    description: "How often the background workers look for webhook deliveries and email jobs to run.",
    env: "WORKER_INTERVAL_MS",
    secret: false,
    group: "logging",
    unit: "ms",
    note: "Applies from the workers' next round.",
  },
}

/** Where the value in use comes from: saved in the console, the server (its env or built-in default), or nowhere. */
export type OperatorSettingSource = "console" | "server" | "unset"

export interface OperatorSetting extends OperatorSettingInfo {
  key: OperatorSettingKey
  source: OperatorSettingSource
  /** The value in use, for settings that aren't secret. Always null for secrets. */
  value: string | null
  /** The last 4 characters of a secret in use. Null for settings that aren't secret. */
  last4: string | null
}

export interface PlatformOperatorSettings {
  settings: OperatorSetting[]
}

/** The result of "Send test email" or "Check billing key". Nothing is changed. */
export interface OperatorCheckResult {
  ok: boolean
  message: string
}

const isSmtpUrl = (v: string) => {
  try {
    const u = new URL(v)
    return (u.protocol === "smtp:" || u.protocol === "smtps:") && u.hostname.length > 0
  } catch {
    return false
  }
}

/** A whole number of milliseconds within the range the server's own env variable allows. */
const milliseconds = (min: number, max: number) =>
  z.coerce
    .number()
    .int("Use a whole number of milliseconds")
    .min(min, `Use at least ${min.toLocaleString("en")} ms`)
    .max(max, `Use at most ${max.toLocaleString("en")} ms`)

/** How each setting's value is checked before it's saved. */
export const operatorSettingValueSchemas = {
  billingPaystackSecretKey: z
    .string()
    .trim()
    .regex(/^sk_(test|live)_[A-Za-z0-9_]{16,}$/, "Paste a Paystack secret key: it starts with sk_test_ or sk_live_"),
  smtpUrl: z
    .string()
    .trim()
    .max(500)
    .refine(isSmtpUrl, "Enter an SMTP URL like smtp://user:password@smtp.example.com:587 (or smtps:// for port 465)"),
  mailFrom: z
    .string()
    .trim()
    .max(200)
    .regex(/^(?:[^<>@\n]*<\s*)?[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+\s*>?$/, 'Enter an address like no-reply@example.com or "YaroPay <no-reply@example.com>"'),
  v1RateLimitPerMinute: z.coerce.number().int("Use a whole number").min(1, "Use at least 1").max(1_000_000, "Use at most 1,000,000"),
  gatewayTimeoutMs: milliseconds(500, 60_000),
  webhookTimeoutMs: milliseconds(500, 60_000),
  sessionDays: z.coerce.number().int("Use a whole number of days").min(1, "Use at least 1 day").max(365, "Use at most 365 days"),
  passwordHashCost: z.enum(PASSWORD_HASH_COSTS, "Choose standard or fast"),
  logLevel: z.enum(LOG_LEVELS, "Choose error, warn, log, debug or verbose"),
  workerIntervalMs: milliseconds(200, 60_000),
} satisfies Record<OperatorSettingKey, z.ZodType>

export const operatorSettingKeySchema = z.enum(OPERATOR_SETTINGS)
export const setOperatorSettingSchema = z.object({ value: z.union([z.string(), z.number()]) })

// ---- Companies, people and teams (super admin) ----

const roleEnum = z.enum(["owner", "admin", "developer", "finance", "viewer"])
const emailField = z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address"))
const companyName = z.string().trim().min(2, "Enter the company's name").max(64)

/** A company created for a customer: its owner gets an invite to set their password. */
export const createWorkspaceSchema = z.object({
  name: companyName,
  ownerEmail: emailField,
  /** A Cloud plan's slug; the sign-up plan when left out. */
  plan: z.string().trim().min(1).max(40).optional(),
  billingCurrency: z.enum(BILLING_CURRENCIES).default("NGN"),
})

export const renameWorkspaceSchema = z.object({ name: companyName })

/** Deleting a company needs its exact name typed back. */
export const deleteWorkspaceSchema = z.object({ confirmName: z.string().trim().min(1, "Type the company's name").max(64) })

export const platformInviteSchema = z.object({ email: emailField, role: roleEnum })

export const platformMemberRoleSchema = z.object({ role: roleEnum })

export const platformUsersQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
})

/** An account anywhere on the platform. */
export interface PlatformUserRow {
  id: string
  name: string
  email: string
  createdAt: string
  lastActiveAt: string | null
  mfaEnabled: boolean
  emailVerified: boolean
  /** Disabled everywhere by the super admin: can't sign in. */
  disabled: boolean
  platformRole: "super_admin" | null
  companies: { id: string; name: string; role: Role; removed: boolean }[]
}

export interface PlatformUserList {
  rows: PlatformUserRow[]
  total: number
}

/** A pending invite to a company, as the console shows it. */
export interface PlatformInvite {
  id: string
  email: string
  role: Role
  invitedBy: string
  createdAt: string
  expiresAt: string
  expired: boolean
}

export interface CreatedWorkspace {
  workspaceId: string
  /** The owner's invite link, to share by hand when email isn't set up. */
  inviteUrl: string
  emailed: boolean
}

export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>
