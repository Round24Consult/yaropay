import { z } from "zod"
import type { Paginated } from "./api.ts"
import type { Permission } from "./auth.ts"

/**
 * Notification catalogue. Each type says who may receive it (a permission,
 * plus product scope when `productId` is set) and which channels are on by
 * default. Members can change the channels per type in Settings.
 */
export type NotificationType =
  | "delivery.failed"
  | "event.unrouted"
  | "event.signature_invalid"
  | "gateway.error"
  | "keys.rotated"
  | "team.member_joined"
  | "security.new_login"

export type NotificationChannel = "inApp" | "email"

export type NotificationSeverity = "info" | "warning" | "critical"

export interface NotificationTypeDefinition {
  type: NotificationType
  label: string
  description: string
  category: "webhooks" | "gateways" | "security" | "team"
  /** Who can receive it. `null` = only the member the event is about. */
  permission: Permission | null
  defaults: Record<NotificationChannel, boolean>
  /** Also posted to the install's alert webhook (Slack, Discord, Teams...) when one is set. */
  alert: boolean
  /** About the whole install rather than one product: members limited to some products don't get it. */
  installWide?: boolean
}

export const NOTIFICATION_TYPES: NotificationTypeDefinition[] = [
  {
    type: "delivery.failed",
    label: "Webhook delivery failed",
    description: "A product stopped accepting events after every retry.",
    category: "webhooks",
    permission: "webhooks:read",
    defaults: { inApp: true, email: true },
    alert: true,
  },
  {
    type: "event.unrouted",
    label: "Unrouted gateway event",
    description: "A gateway event matched no product and was held for review.",
    category: "webhooks",
    permission: "webhooks:read",
    defaults: { inApp: true, email: false },
    alert: false,
    installWide: true,
  },
  {
    type: "event.signature_invalid",
    label: "Invalid webhook signature",
    description: "Someone posted an event to a gateway webhook URL with a bad signature.",
    category: "security",
    permission: "gateways:write",
    defaults: { inApp: true, email: true },
    alert: true,
  },
  {
    type: "gateway.error",
    label: "Gateway rejected a request",
    description: "A gateway refused the saved keys or was unreachable while starting a payment.",
    category: "gateways",
    permission: "gateways:read",
    defaults: { inApp: true, email: true },
    alert: true,
  },
  {
    type: "keys.rotated",
    label: "Keys rotated",
    description: "A product API key, signing secret or gateway key was replaced.",
    category: "security",
    permission: "products:keys",
    defaults: { inApp: true, email: false },
    alert: false,
  },
  {
    type: "team.member_joined",
    label: "New team member",
    description: "Someone accepted an invite.",
    category: "team",
    permission: "team:read",
    defaults: { inApp: true, email: false },
    alert: false,
  },
  {
    type: "security.new_login",
    label: "New sign-in to your account",
    description: "Your account signed in from a new browser or network.",
    category: "security",
    permission: null,
    defaults: { inApp: true, email: true },
    alert: false,
  },
]

export const NOTIFICATION_TYPE_IDS = NOTIFICATION_TYPES.map((t) => t.type) as [NotificationType, ...NotificationType[]]

export function notificationType(type: NotificationType): NotificationTypeDefinition {
  const def = NOTIFICATION_TYPES.find((t) => t.type === type)
  if (!def) throw new Error(`Unknown notification type: ${type}`)
  return def
}

export interface AppNotification {
  id: string
  type: NotificationType
  title: string
  body: string
  /** Dashboard path, e.g. `/webhooks?tab=deliveries`. */
  link: string | null
  severity: NotificationSeverity
  productId: string | null
  readAt: string | null
  createdAt: string
}

export interface NotificationList extends Paginated<AppNotification> {
  unread: number
}

export interface NotificationPreference {
  type: NotificationType
  inApp: boolean
  email: boolean
}

export const notificationPreferencesSchema = z
  .array(z.object({ type: z.enum(NOTIFICATION_TYPE_IDS), inApp: z.boolean(), email: z.boolean() }))
  .max(NOTIFICATION_TYPES.length)
