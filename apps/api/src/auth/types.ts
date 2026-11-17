import type { Permission, PlatformRole, Role } from "@yaropay/core/auth"
import type { Request } from "express"

export interface Actor {
  id: string
  name: string
  email: string
  /** The workspace this session works in. Every query an actor makes is limited to it. */
  workspaceId: string
  /** Role in that workspace. */
  role: Role
  /** Product scope in that workspace. Null = every product in it. */
  productIds: string[] | null
  /** What the role allows in that workspace, resolved once per request (see PERMISSION_RESOLVER). */
  permissions: readonly Permission[]
  /** Two-step sign-in is on for the account. */
  mfaEnabled: boolean
  /** `super_admin` runs the platform (Cloud). Not a workspace role: it grants nothing inside a company. */
  platformRole: PlatformRole | null
  /** A super admin's read-only support view of this workspace (they aren't a member of it). */
  support?: { reason: string; expiresAt: Date } | null
  createdAt: Date
}

export type Assurance = "pending" | "password" | "mfa"

/** The session behind a request: guards read how it was signed in and how recently. */
export interface SessionContext {
  id: string
  /** `pending`: password right, authenticator code still owed. */
  assurance: Assurance
  /** When the password (and code) were last entered. */
  authenticatedAt: Date
  /** A support view: every change is refused. */
  readOnly: boolean
}

export interface AuthedRequest extends Request {
  user: Actor
  session: SessionContext
}

/** Who did something and in which workspace, for the audit log (and for scoping the change). */
export interface AuditContext {
  workspaceId: string
  actorId: string | null
  actorName: string
  ip: string | null
}

export function auditContext(user: Actor, req: Request): AuditContext {
  return { workspaceId: user.workspaceId, actorId: user.id, actorName: user.name, ip: req.ip ?? null }
}

/** Changes made by YaroPay itself (gateway webhooks, workers) on a workspace's behalf. */
export function systemContext(workspaceId: string): AuditContext {
  return { workspaceId, actorId: null, actorName: "System", ip: null }
}
