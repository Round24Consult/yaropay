import { format, formatDistanceToNowStrict, isToday, isYesterday } from "date-fns"
import type { Granularity } from "@yaropay/core/analytics"

export function formatDateTime(iso: string) {
  const d = new Date(iso)
  if (isToday(d)) return `Today, ${format(d, "HH:mm")}`
  if (isYesterday(d)) return `Yesterday, ${format(d, "HH:mm")}`
  return format(d, "d MMM yyyy, HH:mm")
}

export function formatDate(iso: string) {
  return format(new Date(iso), "d MMM yyyy")
}

export function formatRelative(iso: string | null) {
  if (!iso) return "never"
  return `${formatDistanceToNowStrict(new Date(iso))} ago`
}

export function formatBucket(iso: string, g: Granularity, long = false) {
  const d = new Date(iso)
  if (g === "month") return format(d, long ? "MMMM yyyy" : "MMM")
  if (g === "week") return long ? `Week of ${format(d, "d MMM yyyy")}` : format(d, "d MMM")
  return format(d, long ? "EEE d MMM yyyy" : "d MMM")
}

export const CHANNEL_LABELS: Record<string, string> = {
  card: "Card",
  bank_transfer: "Bank transfer",
  ussd: "USSD",
  mobile_money: "Mobile money",
  bank: "Bank account",
  qr: "QR",
}

export const STATUS_LABELS: Record<string, string> = {
  success: "Succeeded",
  failed: "Failed",
  abandoned: "Abandoned",
  pending: "Pending",
  reversed: "Reversed",
}

export const KIND_LABELS: Record<string, string> = {
  website: "Website",
  saas: "SaaS app",
  mobile: "Mobile app",
  other: "Other",
}

/** Two-letter initials for avatars. */
export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  const letters = parts.length === 1 ? parts[0].slice(0, 2) : `${parts[0][0]}${parts[parts.length - 1][0]}`
  return letters.toUpperCase()
}

/** Channel label, or an em dash while the gateway has not said how the customer paid. */
export function channelLabel(channel: string | null | undefined) {
  return channel ? (CHANNEL_LABELS[channel] ?? channel) : "—"
}
