import { z } from "zod"
import type { Role } from "./auth.ts"
import type { Mode } from "./types.ts"

/**
 * AI apps (MCP): what the API and the dashboard share. Paid feature `mcp`. An AI app (Claude, ChatGPT,
 * Cursor, VS Code...) connects to `<base URL>/mcp` with a token that belongs to one member of one
 * company, and sees what that member may see, in test mode unless live was allowed.
 */

export const MCP_SCOPES = ["mcp:read", "mcp:actions"] as const
export type McpScope = (typeof MCP_SCOPES)[number]

/** Personal access tokens last at most this long. */
export const MCP_TOKEN_MAX_DAYS = 90

/** Token prefixes, so secret scanners can recognise a leaked one. */
export const MCP_TOKEN_PREFIX = { access: "ypmcp_at_", refresh: "ypmcp_rt_", personal: "ypmcp_pat_" } as const

/** What a company lets AI apps do (Settings → AI apps). */
export interface McpSettings {
  enabled: boolean
  /** Roles whose members may connect AI apps. */
  allowedRoles: Role[]
  /** Whether connections may be allowed to see live data. */
  liveAllowed: boolean
  /** Whether AI apps may ask for actions (each one still needs approval in YaroPay). */
  actionsAllowed: boolean
  /** Off: customer emails are masked and names cut to initials in what AI apps receive. */
  shareCustomerDetails: boolean
  updatedAt: string | null
}

export const MCP_DEFAULT_SETTINGS: McpSettings = {
  enabled: true,
  allowedRoles: ["owner", "admin", "developer", "finance", "viewer"],
  liveAllowed: false,
  actionsAllowed: true,
  shareCustomerDetails: false,
  updatedAt: null,
}

const role = z.enum(["owner", "admin", "developer", "finance", "viewer"])

export const mcpSettingsSchema = z
  .object({
    enabled: z.boolean().optional(),
    allowedRoles: z.array(role).min(1, "Allow at least one role").max(5).optional(),
    liveAllowed: z.boolean().optional(),
    actionsAllowed: z.boolean().optional(),
    shareCustomerDetails: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), "Nothing to update")

export type McpSettingsInput = z.infer<typeof mcpSettingsSchema>

/** Why a connection ended, when it was ended for the member rather than by them. */
export type McpRevokeReason =
  | "revoked"
  | "revoked_by_app"
  | "refresh_reused"
  | "code_reused"
  | "password_changed"
  | "password_reset"
  | "two_step_off"
  | "two_step_reset"
  | "account_disabled"
  | "expired"

/** One connected AI app or personal access token. */
export interface McpConnection {
  id: string
  kind: "oauth" | "token"
  /** The app's name, or the token's label. */
  name: string
  user: { id: string; name: string; email: string }
  scopes: McpScope[]
  liveAllowed: boolean
  /** `ypmcp_pat_••••abcd` for personal tokens. */
  tokenPreview: string | null
  createdAt: string
  lastUsedAt: string | null
  expiresAt: string | null
  /** The signed-in member's own connection. */
  mine: boolean
}

export const createMcpTokenSchema = z.object({
  name: z.string().trim().min(1, "Give the token a name").max(80, "Use 80 characters or fewer"),
  days: z.number().int().min(1).max(MCP_TOKEN_MAX_DAYS, `Tokens last at most ${MCP_TOKEN_MAX_DAYS} days`),
  /** Live data as well as test data. Needs two-step sign-in and a recent sign-in. */
  live: z.boolean().default(false),
  /** Let the app ask for actions; each one still waits for approval in YaroPay. */
  actions: z.boolean().default(false),
})

export type CreateMcpTokenInput = z.infer<typeof createMcpTokenSchema>

/** Returned once when a personal access token is created. */
export interface CreatedMcpToken {
  connection: McpConnection
  /** Shown once. */
  token: string
}

export interface McpInfo {
  /** The MCP server URL to paste into AI apps. */
  url: string
  /** Whether AI apps work for this member in this company right now. */
  available: boolean
  /** Why not, in plain words. Null when available. */
  reason: string | null
  /** Whether this member may give a connection live access (company allows it and two-step sign-in is on). */
  liveAvailable: boolean
  settings: McpSettings
  /** May change the company's controls and see everyone's connections. */
  canManage: boolean
}

/** One tool call an AI app made (Settings → AI apps → Activity). */
export interface McpActivityEntry {
  id: string
  at: string
  tool: string
  mode: Mode | null
  outcome: "ok" | "error" | "denied" | "approval_required" | "rate_limited"
  errorCode: string | null
  connectionName: string
  userName: string | null
  durationMs: number
}

/** How long OAuth tokens last. A connection made by signing in lasts 90 days, then the app asks again. */
export const MCP_OAUTH = { accessTokenSeconds: 3600, refreshTokenDays: 30, connectionDays: 90 } as const

/** A company the member could connect an AI app to, on the consent page. */
export interface McpConsentCompany {
  id: string
  name: string
  role: Role
  /** The company the dashboard is showing now. */
  current: boolean
  available: boolean
  /** Why AI apps can't be used there. Null when they can. */
  reason: string | null
  /** The company allows live data and this member has two-step sign-in on. */
  liveAvailable: boolean
  /** The company allows actions and this member's role may do at least one of them. */
  actionsAvailable: boolean
}

/** What the consent page shows: which app is asking, where it sends you back, and where it may connect. */
export interface McpConsentRequest {
  id: string
  client: {
    name: string
    /** The client ID metadata document's address, or a registered id. */
    clientId: string
    /** `cimd`: the app published its details at an https address; `dcr`: it registered itself here. */
    kind: "cimd" | "dcr"
    /** The host the app's details came from (CIMD), the only part YaroPay can vouch for. */
    host: string | null
    uri: string | null
    logoUri: string | null
  }
  /** Where approving sends you: a website's host, or "an app on this computer". */
  redirect: { host: string; local: boolean; customScheme: boolean }
  companies: McpConsentCompany[]
  mfaEnabled: boolean
  expiresAt: string
}

export const mcpConsentSchema = z.object({
  workspaceId: z.string().min(1).max(64),
  live: z.boolean().default(false),
  actions: z.boolean().default(false),
})

export type McpConsentInput = z.infer<typeof mcpConsentSchema>

/** Where the browser goes next: back to the AI app, with a code or an error. */
export interface McpConsentResult {
  redirectUrl: string
}

/** The actions AI apps may ask for. Each one waits for its member's approval in YaroPay. */
export const MCP_ACTIONS = {
  recheck_payment: { title: "Re-check a payment with the gateway", permission: "transactions:verify" },
  retry_webhook_delivery: { title: "Retry a webhook delivery", permission: "webhooks:replay" },
  create_payment_link: { title: "Create a payment link", permission: "transactions:create" },
} as const

export type McpActionTool = keyof typeof MCP_ACTIONS

/** How long an action waits for approval. */
export const MCP_APPROVAL_MINUTES = 15

export type McpApprovalStatus = "pending" | "executing" | "succeeded" | "failed" | "denied" | "expired"

/** An action waiting for (or past) its member's approval: what the approval page shows. */
export interface McpApproval {
  id: string
  tool: McpActionTool
  title: string
  mode: Mode
  /** What will happen, line by line, worked out when the app asked. */
  details: { label: string; value: string }[]
  client: string
  company: string
  status: McpApprovalStatus
  createdAt: string
  expiresAt: string
  decidedAt: string | null
  /** After it ran: a sentence, and a link to copy when there is one (a checkout). */
  result: { summary: string; link: string | null } | null
  error: string | null
}
