import { z } from "zod"

/**
 * Editions and paid features. Community is the open-source build and has none of the features below.
 * Enterprise (self-hosted, with a licence key) and Cloud (app.yaropay.com) turn them on. The API decides
 * what a workspace may use (GET /api/entitlements); the dashboard reads the same list to show what is
 * locked. Payments never depend on any of this: a lapsed licence or plan only locks paid features.
 */
export type Edition = "community" | "enterprise" | "cloud"

export const FEATURES = [
  "multi_workspace",
  "custom_roles",
  "audit_export",
  "sso",
  "enforce_2fa",
  "refunds",
  "reconciliation",
  "scheduled_reports",
  "priority_support",
  "mcp",
] as const

export type Feature = (typeof FEATURES)[number]

export function isFeature(v: unknown): v is Feature {
  return typeof v === "string" && (FEATURES as readonly string[]).includes(v)
}

/**
 * Features named in a licence or plan, minus any this build doesn't know. Licences outlive releases:
 * a feature can be renamed or become free (gateways did), and an old key must keep working.
 */
export function knownFeatures(values: readonly unknown[]): Feature[] {
  return [...new Set(values.filter(isFeature))]
}

export const FEATURE_INFO: Record<Feature, { label: string; description: string }> = {
  multi_workspace: { label: "Several companies", description: "Run more than one company on one install, each with its own gateways, products, team and settings." },
  custom_roles: { label: "Custom roles", description: "Build roles from individual permissions instead of the five built-in ones." },
  audit_export: { label: "Audit log export", description: "Filter, export and keep the audit log for as long as you need." },
  sso: { label: "Single sign-on", description: "Sign in with Google Workspace, Microsoft Entra or any OpenID Connect provider." },
  enforce_2fa: { label: "Required two-step sign-in", description: "Make two-step verification mandatory for everyone in the company." },
  refunds: { label: "Refunds", description: "Refund payments from the dashboard and tell the product about it." },
  reconciliation: { label: "Settlement reconciliation", description: "Match gateway settlements against payments and spot what is missing." },
  scheduled_reports: { label: "Scheduled reports", description: "Email payment reports to finance on a schedule." },
  priority_support: { label: "Priority support", description: "Answers from the team that builds YaroPay, with agreed response times." },
  mcp: { label: "AI assistants (MCP)", description: "Connect Claude, ChatGPT, Cursor and other AI apps to ask about payments and run approved actions." },
}

/** How long paid features keep working after a licence expires. */
export const LICENCE_GRACE_DAYS = 14

export type LicenceStatus = "valid" | "grace" | "expired"

export interface LicenceSummary {
  id: string
  customer: string
  status: LicenceStatus
  features: Feature[]
  /** Live products the licence covers each month. Null: no limit. */
  liveProducts: number | null
  /** Companies the install may run. Null: no limit. */
  workspaces: number | null
  issuedAt: string
  expiresAt: string
  /** Paid features stop after this day if the licence isn't renewed. */
  graceEndsAt: string
}

export interface Entitlements {
  edition: Edition
  /** Paid features this workspace may use right now. */
  features: Feature[]
  limits: { workspaces: number | null; liveProducts: number | null }
  /** Self-hosted Enterprise: the installed licence, if any. */
  licence: LicenceSummary | null
  /** Whether this install takes a licence key (only the Enterprise build does). */
  acceptsLicence: boolean
}

export const COMMUNITY_ENTITLEMENTS: Entitlements = {
  edition: "community",
  features: [],
  limits: { workspaces: 1, liveProducts: null },
  licence: null,
  acceptsLicence: false,
}

export function hasFeature(entitlements: Pick<Entitlements, "features"> | null | undefined, feature: Feature): boolean {
  return !!entitlements && entitlements.features.includes(feature)
}

/** Licence keys start with "YP1." (format version 1). */
export const licenceKeySchema = z.object({
  key: z
    .string()
    .trim()
    .min(1, "Paste the licence key")
    .max(8192, "That is too long to be a licence key")
    .refine((k) => k.startsWith("YP1."), "Licence keys start with YP1."),
})
