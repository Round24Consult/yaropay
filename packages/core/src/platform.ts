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
