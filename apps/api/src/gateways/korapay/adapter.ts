/**
 * Korapay Checkout Redirect. Written from Korapay's developer documentation:
 * - Initialize a charge and the redirect back: https://developers.korapay.com/docs/checkout-redirect
 * - Verify a charge (GET /charges/{reference}) and its response:
 *   https://developers.korapay.com/docs/accepting-card-payments-with-apis
 * - Webhooks, events and x-korapay-signature: https://developers.korapay.com/docs/webhooks
 * - Balances, used to test keys: https://developers.korapay.com/docs/balance-api
 * - Mobile money currencies: https://developers.korapay.com/docs/mobile-money
 *
 * Korapay counts amounts in major units (naira, shillings). YaroPay's reference is Korapay's charge reference.
 */
import { type CurrencyCode, toMajorUnits, toMinorUnits } from "@yaropay/core/currencies"
import type { PaymentChannel, TransactionStatus } from "@yaropay/core/types"
import { hmacHex, safeEqual } from "../../common/crypto.js"
import { asCurrency, asRecord, type CallbackParams, type GatewayAdapter, GatewayError, type GatewayPayment, gatewayRequest, header, type ParsedWebhook } from "../kit.js"

const NAME = "Korapay"

interface KorapayEnvelope<T> {
  status?: boolean
  message?: string
  data?: T
}

interface KorapayCharge {
  reference?: string
  payment_reference?: string
  status?: string
  amount?: number | string
  amount_paid?: number | string
  fee?: number | string
  currency?: string
  description?: string
  payment_method?: string
  transaction_date?: string
  card?: Record<string, unknown>
  payment_attempts?: { status?: string; channel?: string; message?: string }[]
  customer?: { email?: string; name?: string }
  metadata?: Record<string, unknown> | null
}

export function korapayStatus(s: string | undefined): TransactionStatus {
  switch ((s ?? "").toLowerCase()) {
    case "success":
      return "success"
    case "failed":
      return "failed"
    case "expired":
    case "abandoned":
    case "cancelled":
      return "abandoned"
    case "reversed":
    case "refunded":
      return "reversed"
    default:
      return "pending"
  }
}

const CHANNELS: Record<string, PaymentChannel> = { card: "card", bank_transfer: "bank_transfer", mobile_money: "mobile_money", pay_with_bank: "bank" }
const KORAPAY_CHANNELS: Partial<Record<PaymentChannel, string>> = { card: "card", bank_transfer: "bank_transfer", mobile_money: "mobile_money", bank: "pay_with_bank" }

/**
 * Korapay metadata takes at most 5 keys of up to 20 characters from A-Z, a-z, 0-9 and "-". YaroPay's own
 * routing key goes first, with "-" in place of "_"; `fromKorapayMetadata` turns it back.
 */
export function toKorapayMetadata(metadata: Record<string, unknown>): Record<string, string> | undefined {
  const out: Record<string, string> = {}
  const entries = Object.entries(metadata).sort(([a], [b]) => (a === "yaropay_product" ? -1 : b === "yaropay_product" ? 1 : 0))
  for (const [key, value] of entries) {
    if (Object.keys(out).length >= 5) break
    if (value === undefined || value === null) continue
    const k = key.replace(/[^A-Za-z0-9-]/g, "-").slice(0, 20)
    if (!k || k in out) continue
    out[k] = typeof value === "string" ? value : JSON.stringify(value)
  }
  return Object.keys(out).length ? out : undefined
}

function fromKorapayMetadata(metadata: unknown): Record<string, unknown> {
  const m = { ...asRecord(metadata) }
  if (typeof m["yaropay-product"] === "string" && m.yaropay_product === undefined) m.yaropay_product = m["yaropay-product"]
  return m
}

function money(v: unknown, currency: CurrencyCode): number {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? toMinorUnits(n, currency) : 0
}

/** Korapay's transaction_date ("2023-01-10 10:00:04", no zone) read as UTC, or an ISO date as given. */
function korapayDate(v: unknown): string | null {
  if (typeof v !== "string" || !v.trim()) return null
  let s = v.trim().replace(" ", "T")
  if (!/(Z|[+-]\d{2}:?\d{2})$/.test(s)) s = `${s}Z`
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

function toPayment(c: KorapayCharge, reference: string): GatewayPayment {
  const currency = asCurrency(c.currency)
  const status = korapayStatus(c.status)
  const paid = money(c.amount_paid, currency)
  const lastAttempt = c.payment_attempts?.[c.payment_attempts.length - 1]
  const method = c.payment_method ?? lastAttempt?.channel ?? (c.card ? "card" : "")
  return {
    reference,
    status,
    amount: paid > 0 ? paid : money(c.amount, currency),
    currency,
    channel: CHANNELS[method] ?? null,
    fee: status === "success" || status === "reversed" ? money(c.fee, currency) : 0,
    paidAt: status === "success" ? korapayDate(c.transaction_date) : null,
    gatewayTransactionId: null,
    customer: { email: c.customer?.email ?? "", name: c.customer?.name ?? "" },
    metadata: fromKorapayMetadata(c.metadata),
    message: status === "failed" ? (lastAttempt?.message ?? null) : null,
  }
}

const NOT_FOUND = /not\s*found|does not exist|invalid reference/i

export const korapayAdapter: GatewayAdapter = {
  id: "korapay",
  name: NAME,
  // Korapay sends the customer back to the same redirect URL whether the payment finished or the checkout
  // was closed, so a cancellation can't be told apart from an unfinished payment.
  confirmsCancellation: false,

  async initialize(ctx, creds, p) {
    const channels = (p.channels ?? []).map((c) => KORAPAY_CHANNELS[c]).filter((c): c is string => !!c)
    const metadata = toKorapayMetadata(p.metadata)
    const { body } = await gatewayRequest<KorapayEnvelope<{ reference?: string; checkout_url?: string }>>(ctx, NAME, "/api/v1/charges/initialize", {
      method: "POST",
      secret: creds.secretKey,
      body: {
        amount: toMajorUnits(p.amount, p.currency),
        currency: p.currency,
        reference: p.reference,
        // Korapay adds ?reference=... itself when it sends the customer back.
        redirect_url: p.callbackUrl,
        narration: p.title || "Payment",
        ...(channels.length ? { channels } : {}),
        customer: { email: p.email, ...(p.name ? { name: p.name } : {}) },
        ...(metadata ? { metadata } : {}),
      },
    })
    if (!body?.status || !body.data?.checkout_url) throw new GatewayError(`${NAME}: ${body?.message ?? "could not start the charge"}`, "request")
    return { authorizationUrl: body.data.checkout_url }
  },

  async verify(ctx, creds, ref) {
    try {
      const { status, body } = await gatewayRequest<KorapayEnvelope<KorapayCharge>>(ctx, NAME, `/api/v1/charges/${encodeURIComponent(ref.reference)}`, { secret: creds.secretKey })
      if (status === 404 || !body?.status || !body.data) return null
      const chargeRef = body.data.reference ?? body.data.payment_reference
      if (chargeRef && chargeRef !== ref.reference) return null
      return toPayment(body.data, ref.reference)
    } catch (e) {
      if (e instanceof GatewayError && e.kind === "request" && NOT_FOUND.test(e.message)) return null
      throw e
    }
  },

  /** `x-korapay-signature` is the HMAC-SHA256 of the payload's `data` object (as JSON), keyed with the secret key. */
  async verifySignature(_ctx, creds, rawBody, headers) {
    const given = header(headers, "x-korapay-signature").toLowerCase()
    if (!given || !creds.secretKey) return false
    let data: unknown
    try {
      data = asRecord(JSON.parse(rawBody.toString("utf8"))).data
    } catch {
      return false
    }
    if (data === undefined) return false
    return safeEqual(hmacHex("sha256", creds.secretKey, JSON.stringify(data)), given)
  },

  parseWebhook(body): ParsedWebhook {
    const b = asRecord(body)
    const type = String(b.event ?? "unknown")
    const data = asRecord(b.data)
    const metadata = fromKorapayMetadata(data.metadata)
    // Refund events carry the refund's own reference; the payment's is payment_reference.
    const reference =
      (type.startsWith("refund.") ? data.payment_reference : (data.reference ?? data.payment_reference)) as string | undefined
    const ref = typeof reference === "string" && reference ? reference : null
    const status: TransactionStatus | null = type === "charge.success" ? "success" : type === "charge.failed" ? "failed" : type === "refund.success" ? "reversed" : null
    if (!ref || !status) return { type, reference: ref, payment: null, metadata }
    const p = toPayment({ ...(data as KorapayCharge), status: status === "reversed" ? "reversed" : String(data.status ?? status) }, ref)
    return {
      type,
      reference: ref,
      payment: { reference: ref, status, amount: p.amount, currency: p.currency, channel: p.channel, fee: status === "success" ? p.fee : 0, paidAt: p.paidAt, gatewayTransactionId: null, customer: p.customer, metadata },
      metadata,
    }
  },

  parseCallback(q): CallbackParams {
    return { reference: q.reference || null, outcome: null, gatewayTransactionId: null }
  },

  async testConnection(ctx, creds) {
    try {
      await gatewayRequest(ctx, NAME, "/api/v1/balances", { secret: creds.secretKey })
      return { ok: true, message: `${NAME} accepted the secret key.` }
    } catch (e) {
      return { ok: false, message: (e as Error).message }
    }
  },
}
