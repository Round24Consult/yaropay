import type { Role } from "./auth.ts"

/**
 * Domain types shared by the dashboard and the NestJS API. Nothing in
 * `@yaropay/core` may import React, Next.js, NestJS or Node-only APIs.
 */

export type Mode = "test" | "live"

export type CurrencyCode = "NGN" | "USD" | "GHS" | "KES" | "ZAR"

export type GatewayId = "paystack" | "flutterwave" | "stripe" | "monnify" | "korapay"

export type TransactionStatus = "success" | "failed" | "abandoned" | "pending" | "reversed"

export type PaymentChannel = "card" | "bank_transfer" | "ussd" | "mobile_money" | "bank" | "qr"

/** Product colours map to the 8 validated categorical slots (1-based). */
export type ColorSlot = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8

export interface PlatformSettings {
  platformName: string
  /** Public base URL of this self-hosted install. Every generated URL derives from it. */
  baseUrl: string
  companyName: string
  defaultCurrency: CurrencyCode
  /**
   * Incoming-webhook URL (Slack, Discord, Teams, or anything that accepts
   * `{ "text": "..." }`) for operational alerts. Masked when read back.
   */
  alertsWebhookUrl: string | null
}

/** An installed gateway account ("app"). Several accounts per gateway are allowed. */
export interface GatewayConnection {
  id: string
  gatewayId: GatewayId
  label: string
  mode: Mode
  /** Credential values with secrets masked, keyed by the gateway's field keys. */
  credentials: Record<string, string>
  status: "active" | "error"
  /** Part of the sample data set: fake keys, can't be used by your own products. */
  sample: boolean
  createdAt: string
  lastEventAt: string | null
}

export interface ProductGateway {
  connectionId: string
  isDefault: boolean
}

export interface Product {
  id: string
  name: string
  slug: string
  kind: "website" | "saas" | "mobile" | "other"
  websiteUrl: string
  colorSlot: ColorSlot
  /** Reference prefix stamped on every payment the platform initialises, e.g. `SHW`. */
  referencePrefix: string
  gateways: ProductGateway[]
  /** The product's own endpoint that receives forwarded, signed events. */
  webhookUrl: string
  successUrl: string
  failureUrl: string
  cancelUrl: string | null
  /** Live API key preview (`ypk_live_••••abcd`). */
  apiKeyPreview: string
  /** Test API key preview (`ypk_test_••••abcd`). The key decides the mode of a payment. */
  testApiKeyPreview: string
  signingSecretPreview: string
  status: "active" | "paused"
  /** Part of the sample data set. */
  sample: boolean
  createdAt: string
}

export type TimelineStepKind =
  | "initialized"
  | "redirected"
  | "callback"
  | "verified"
  | "webhook_received"
  | "routed"
  | "forwarded"
  | "failed"

export interface TimelineStep {
  kind: TimelineStepKind
  at: string
  title: string
  detail?: string
  ok: boolean
}

export interface Customer {
  email: string
  name: string
}

export interface Transaction {
  id: string
  reference: string
  productId: string
  connectionId: string
  gatewayId: GatewayId
  mode: Mode
  /** Minor units (kobo, cents, pesewas). */
  amount: number
  /** Gateway fee in minor units. */
  fee: number
  currency: CurrencyCode
  status: TransactionStatus
  /** Unknown until the gateway reports how the customer paid. */
  channel: PaymentChannel | null
  customer: Customer
  createdAt: string
  paidAt: string | null
  timeline: TimelineStep[]
}

export interface WebhookEvent {
  id: string
  gatewayId: GatewayId
  connectionId: string
  mode: Mode
  type: string
  reference: string | null
  signatureValid: boolean
  /** Null when the event could not be matched to a product ("unrouted"). */
  productId: string | null
  receivedAt: string
  payload: Record<string, unknown>
}

export type DeliveryState = "pending" | "delivered" | "retrying" | "failed"

export interface WebhookDelivery {
  id: string
  /** The gateway event that caused it. Null when the callback settled the payment first, or for test pings. */
  eventId: string | null
  transactionId: string | null
  productId: string
  mode: Mode
  url: string
  eventType: string
  state: DeliveryState
  statusCode: number | null
  attempts: number
  nextRetryAt: string | null
  latencyMs: number | null
  createdAt: string
  lastAttemptAt: string | null
  responseSnippet: string
}

export interface TeamMember {
  id: string
  name: string
  email: string
  role: Role
  /** `null` = every product. */
  productIds: string[] | null
  lastActiveAt: string | null
  createdAt: string
}

export interface AuditEntry {
  id: string
  actor: string
  action: string
  target: string
  ip: string | null
  at: string
}
