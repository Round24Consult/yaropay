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
export type McpRevokeReason = "revoked" | "password_changed" | "password_reset" | "two_step_off" | "two_step_reset" | "account_disabled" | "expired"

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
