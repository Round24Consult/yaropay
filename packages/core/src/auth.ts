import { z } from "zod"

/**
 * Roles and permissions. The API enforces them; the dashboard reads the same
 * table to hide controls a member cannot use. Product scoping (a member who
 * only sees some products) is separate from the role: see `SessionUser.productIds`.
 */
export type Role = "owner" | "admin" | "developer" | "finance" | "viewer"

export const PERMISSIONS = [
  "dashboard:read",
  "transactions:read",
  "transactions:export",
  "products:read",
  "products:write",
  "products:delete",
  "products:keys",
  "gateways:read",
  "gateways:write",
  "webhooks:read",
  "webhooks:replay",
  "settings:read",
  "settings:write",
  "team:read",
  "team:write",
  "audit:read",
] as const

export type Permission = (typeof PERMISSIONS)[number]

const READ: Permission[] = [
  "dashboard:read",
  "transactions:read",
  "products:read",
  "gateways:read",
  "webhooks:read",
  "settings:read",
  "team:read",
]

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: PERMISSIONS,
  admin: PERMISSIONS,
  developer: [...READ, "transactions:export", "products:write", "products:keys", "webhooks:replay", "audit:read"],
  finance: [...READ, "transactions:export", "audit:read"],
  viewer: READ,
}

export const ROLES: { value: Role; label: string; description: string }[] = [
  { value: "owner", label: "Owner", description: "Full access, including other owners and admins." },
  { value: "admin", label: "Admin", description: "Full access to products, gateways, settings and the team." },
  {
    value: "developer",
    label: "Developer",
    description: "Builds integrations: edits products, rotates product keys, replays webhooks.",
  },
  { value: "finance", label: "Finance", description: "Reads and exports payments. Cannot change configuration." },
  { value: "viewer", label: "Viewer", description: "Read-only access to the dashboard and payments." },
]

/** Higher rank can manage lower ranks. Owners can manage everyone, including other owners. */
export const ROLE_RANK: Record<Role, number> = { owner: 4, admin: 3, developer: 2, finance: 2, viewer: 1 }

/**
 * What a super admin sees in a company's support view: every read permission and the audit log, and
 * nothing that changes anything or exports in bulk.
 */
export const SUPPORT_PERMISSIONS: readonly Permission[] = PERMISSIONS.filter((p) => p.endsWith(":read"))

/** How long a support view lasts. */
export const SUPPORT_VIEW_MINUTES = 60

export function permissionsFor(role: Role): Permission[] {
  return [...ROLE_PERMISSIONS[role]]
}

/** Uses the member's resolved permissions when known (they can differ from the role's defaults in paid
 * editions with custom roles), otherwise the role's built-in list. */
export function hasPermission(user: { role: Role; permissions?: readonly Permission[] } | null | undefined, permission: Permission): boolean {
  if (!user) return false
  return (user.permissions ?? ROLE_PERMISSIONS[user.role]).includes(permission)
}

/** Whether `actor` may invite, edit or remove a member who has (or would get) `target`. */
export function canManageRole(actor: Role, target: Role): boolean {
  if (actor === "owner") return true
  return ROLE_RANK[actor] > ROLE_RANK[target]
}

/** Roles `actor` may hand out. */
export function assignableRoles(actor: Role): Role[] {
  return ROLES.map((r) => r.value).filter((r) => canManageRole(actor, r))
}

/** `null` means every product. A scoped member only sees the listed products. */
export function canSeeProduct(user: { productIds: string[] | null }, productId: string): boolean {
  return user.productIds === null || user.productIds.includes(productId)
}

/** A company the member belongs to (several are possible on Cloud and Enterprise installs). */
export interface WorkspaceSummary {
  id: string
  name: string
  role: Role
}

export interface SessionUser {
  id: string
  name: string
  email: string
  /** Role and product scope in the active workspace. */
  role: Role
  productIds: string[] | null
  permissions: Permission[]
  createdAt: string
  /** The workspace this session is working in. */
  workspace: { id: string; name: string }
  /** Every workspace the member can switch to, including the active one. */
  workspaces: WorkspaceSummary[]
  /** Two-step sign-in is on for this account. */
  mfaEnabled: boolean
  /** `super_admin`: runs YaroPay Cloud and can open the platform console. */
  platformRole: PlatformRole | null
  /** Set while a super admin looks at this workspace in a read-only support view. */
  support: { reason: string; expiresAt: string } | null
}

export type PlatformRole = "super_admin"

/** Signing in either finishes, or (with two-step sign-in on) asks for an authenticator code next. */
export type LoginResult = { user: SessionUser } | { mfaRequired: true }

/** Two-step sign-in for the signed-in account. */
export interface MfaStatus {
  enabled: boolean
  enabledAt: string | null
  /** Unused recovery codes left. */
  recoveryCodesLeft: number
}

/** Returned when setting up two-step sign-in: the app scans `otpauthUri` (or types `secret`). */
export interface MfaSetup {
  secret: string
  otpauthUri: string
}

/** Sensitive actions (the platform console, for one) need the password entered this recently. */
export const RECENT_AUTH_MINUTES = 15

export interface AuthState {
  /** True until the first owner account is created. */
  needsSetup: boolean
  /** Whether the API can send email (invites, password resets). */
  emailEnabled: boolean
  /** The install was started with SETUP_TOKEN: first-run setup needs it. */
  setupTokenRequired: boolean
  /** YaroPay Cloud with sign-ups open: anyone can create a company at /signup. */
  signupEnabled: boolean
}

/** How long a browser stays trusted after the code is entered on it. Fixed: using it doesn't extend it. */
export const TRUSTED_BROWSER_DAYS = 30

/** A browser that skips the authenticator code at sign-in (Settings → Security). */
export interface TrustedBrowser {
  id: string
  /** "Chrome on macOS" */
  label: string
  createdAt: string
  lastUsedAt: string | null
  expiresAt: string
  /** The browser this list is being viewed in. */
  current: boolean
}

export interface SessionInfo {
  id: string
  userAgent: string | null
  ip: string | null
  createdAt: string
  lastSeenAt: string
  current: boolean
}

export interface Invite {
  id: string
  email: string
  role: Role
  productIds: string[] | null
  invitedBy: string
  createdAt: string
  expiresAt: string
  expired: boolean
}

/** Returned once when an invite is created or resent, so it can be shared by hand when email is off. */
export interface CreatedInvite {
  invite: Invite
  inviteUrl: string
  emailed: boolean
}

export interface InvitePreview {
  email: string
  role: Role
  invitedBy: string
  companyName: string
  platformName: string
  /** The email already has an account: joining needs that account's password, not a new one. */
  existingAccount: boolean
}

export const PASSWORD_MIN = 10

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters`)
  .max(128, "Use at most 128 characters")

const email = z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address"))
const name = z.string().trim().min(2, "Enter your name").max(64)

export const loginSchema = z.object({
  email,
  password: z.string().min(1, "Enter your password").max(128),
})

export const setupSchema = z.object({
  name,
  email,
  password: passwordSchema,
  companyName: z.string().trim().min(2, "Enter your company name").max(64),
  /** SETUP_TOKEN from the server's environment, when the install requires one. */
  setupToken: z.string().trim().max(256).optional(),
})

export const acceptInviteSchema = z.object({ name, password: passwordSchema })

/** YaroPay Cloud: a new company and its owner. The email must be confirmed before signing in. */
export const signupSchema = z.object({
  name,
  email,
  password: passwordSchema,
  companyName: z.string().trim().min(2, "Enter your company name").max(64),
  currency: z.enum(["NGN", "USD"]).default("NGN"),
})

export const verifyEmailSchema = z.object({ token: z.string().min(16).max(256) })

export const resendVerificationSchema = z.object({ email })

export type SignupInput = z.infer<typeof signupSchema>

/** Accepting an invite with an account that already exists on this install. */
export const joinInviteSchema = z.object({ password: z.string().min(1, "Enter your password").max(128) })

export const switchWorkspaceSchema = z.object({ workspaceId: z.string().min(1).max(64) })

export const forgotPasswordSchema = z.object({ email })

export const resetPasswordSchema = z.object({ token: z.string().min(16).max(256), password: passwordSchema })

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Enter your current password").max(128),
  newPassword: passwordSchema,
})

export const profileSchema = z.object({ name })

const currentPassword = z.string().min(1, "Enter your password").max(128)
const totp = z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code from your app")

/** The code step after signing in: a 6-digit authenticator code, or one of the recovery codes. */
export const mfaVerifySchema = z.object({
  code: z.string().trim().min(6, "Enter the code").max(32),
  /** Skip the code on this browser for TRUSTED_BROWSER_DAYS (the password is still asked for). */
  trustBrowser: z.boolean().optional(),
})

/** Starting setup asks for the password again, so an unattended browser can't add someone else's phone. */
export const mfaSetupSchema = z.object({ password: currentPassword })

/** Confirms setup with the first code the app shows. */
export const mfaEnableSchema = z.object({ code: totp })

/** Turning it off needs the password and a code (or a recovery code). */
export const mfaDisableSchema = z.object({ password: currentPassword, code: z.string().trim().min(6, "Enter the code").max(32) })

export const recoveryCodesSchema = z.object({ password: currentPassword })

/** Confirms the password (and code, if two-step sign-in is on) before a sensitive action. */
export const reauthSchema = z.object({ password: currentPassword, code: z.string().trim().max(32).optional() })

const role = z.enum(["owner", "admin", "developer", "finance", "viewer"])
const productScope = z.array(z.string().min(1)).max(200).nullable()

export const inviteSchema = z.object({
  email,
  role,
  productIds: productScope.default(null),
})

export const updateMemberSchema = z
  .object({ role: role.optional(), productIds: productScope.optional() })
  .refine((v) => v.role !== undefined || v.productIds !== undefined, "Nothing to update")

export type LoginInput = z.infer<typeof loginSchema>
export type SetupInput = z.infer<typeof setupSchema>
export type InviteInput = z.infer<typeof inviteSchema>
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>
