import { z } from "zod"
import { AVAILABLE_GATEWAY_IDS, SUPPORTED_CURRENCIES } from "./gateways/registry.ts"
import type { CurrencyCode, GatewayId, Mode, PaymentChannel, TransactionStatus } from "./types.ts"

/**
 * Public API used by product servers (`/v1/products/{productId}/payments`) and
 * the events YaroPay forwards to each product's webhook endpoint.
 */

export const API_KEY_PREFIX: Record<Mode, string> = { live: "ypk_live_", test: "ypk_test_" }
export const SIGNING_SECRET_PREFIX = "whsec_"

export function modeOfApiKey(key: string): Mode | null {
  if (key.startsWith(API_KEY_PREFIX.live)) return "live"
  if (key.startsWith(API_KEY_PREFIX.test)) return "test"
  return null
}

export const createPaymentSchema = z.object({
  /** Minor units: kobo, cents, pesewas. */
  amount: z.number().int("Amount must be in minor units (an integer)").positive().max(1_000_000_000_000),
  /** Any currency an installed gateway accepts; the chosen gateway must accept it too. */
  currency: z.enum(SUPPORTED_CURRENCIES as [CurrencyCode, ...CurrencyCode[]]),
  email: z.string().trim().toLowerCase().pipe(z.email("Enter the customer's email address")),
  name: z.string().trim().max(120).optional(),
  /** `default` (or omitted) uses the product's default gateway for the key's mode. */
  gateway: z.union([z.literal("default"), z.enum(AVAILABLE_GATEWAY_IDS as [GatewayId, ...GatewayId[]])]).optional(),
  /** Optional reference. It must start with the product prefix, e.g. `SHW_ORDER1042`. */
  reference: z
    .string()
    .trim()
    .regex(/^[A-Z][A-Z0-9]{1,5}_[A-Za-z0-9._-]{4,64}$/, "Use PREFIX_ followed by 4 to 64 letters, digits, dots, dashes or underscores")
    .optional(),
  channels: z.array(z.enum(["card", "bank_transfer", "ussd", "mobile_money", "bank", "qr"])).max(6).optional(),
  metadata: z
    .record(z.string(), z.unknown())
    .refine((m) => JSON.stringify(m).length <= 4_000, "Metadata must be under 4 KB")
    .optional(),
})

export type CreatePaymentInput = z.infer<typeof createPaymentSchema>

export interface PaymentResponse {
  id: string
  reference: string
  productId: string
  gateway: GatewayId
  connectionId: string
  mode: Mode
  amount: number
  currency: CurrencyCode
  status: TransactionStatus
  channel: PaymentChannel | null
  /** Send the customer here to pay. Null once the payment is settled. */
  authorizationUrl: string | null
  metadata: Record<string, unknown>
  createdAt: string
  paidAt: string | null
}

export type ProductEventType =
  | "payment.succeeded"
  | "payment.failed"
  | "payment.abandoned"
  | "payment.reversed"
  | "test.ping"

export const PRODUCT_EVENT_TYPES: ProductEventType[] = [
  "payment.succeeded",
  "payment.failed",
  "payment.abandoned",
  "payment.reversed",
  "test.ping",
]

export function eventTypeForStatus(status: TransactionStatus): ProductEventType | null {
  switch (status) {
    case "success":
      return "payment.succeeded"
    case "failed":
      return "payment.failed"
    case "abandoned":
      return "payment.abandoned"
    case "reversed":
      return "payment.reversed"
    default:
      return null
  }
}

/** Body of every event YaroPay POSTs to a product. */
export interface ProductEvent {
  id: string
  type: ProductEventType
  mode: Mode
  createdAt: string
  data: {
    id: string
    reference: string
    productId: string
    gateway: GatewayId
    amount: number
    fee: number
    currency: CurrencyCode
    status: TransactionStatus
    channel: PaymentChannel | null
    customer: { email: string; name: string }
    metadata: Record<string, unknown>
    paidAt: string | null
  }
}

/** Headers on every forwarded event. */
export const PLATFORM_EVENT_HEADER = "x-yaropay-event"
export const PLATFORM_DELIVERY_HEADER = "x-yaropay-delivery"

/**
 * `x-yaropay-signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">`.
 * Reject events whose timestamp is older than this many seconds.
 */
export const SIGNATURE_TOLERANCE_SECONDS = 300

export function parseSignatureHeader(header: string): { t: number; v1: string[] } | null {
  let t = Number.NaN
  const v1: string[] = []
  for (const part of header.split(",")) {
    const [k, v] = part.trim().split("=", 2)
    if (k === "t") t = Number(v)
    else if (k === "v1" && v) v1.push(v)
  }
  return Number.isFinite(t) && v1.length ? { t, v1 } : null
}
