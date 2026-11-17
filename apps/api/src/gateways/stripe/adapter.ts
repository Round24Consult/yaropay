/**
 * Stripe Checkout. Written from Stripe's API documentation:
 * - Create and retrieve a Checkout Session: https://docs.stripe.com/api/checkout/sessions/create,
 *   https://docs.stripe.com/api/checkout/sessions/object (status, payment_status)
 * - Success URL with {CHECKOUT_SESSION_ID}: https://docs.stripe.com/payments/checkout/custom-success-page
 * - Amounts and zero-decimal currencies: https://docs.stripe.com/currencies
 * - Webhook signatures (Stripe-Signature, t= and v1=): https://docs.stripe.com/webhooks
 *
 * YaroPay creates one Checkout Session per payment. The session id is the checkout id; the session's
 * client_reference_id and metadata carry YaroPay's reference and routing metadata.
 */
import { type CurrencyCode, minorUnitExponent } from "@yaropay/core/currencies"
import type { PaymentChannel, TransactionStatus } from "@yaropay/core/types"
import { hmacHex, safeEqual } from "../../common/crypto.js"
import {
  asCurrency,
  asRecord,
  type CallbackParams,
  type GatewayAdapter,
  GatewayError,
  type GatewayPayment,
  gatewayRequest,
  header,
  type ParsedWebhook,
} from "../kit.js"

const NAME = "Stripe"
/** Pinned so a change to the account's default API version can't change the response shapes. */
const STRIPE_VERSION = "2026-10-28.endive"
/** How old a webhook signature may be before it's refused (Stripe's libraries use 5 minutes). */
export const SIGNATURE_TOLERANCE_SECONDS = 300

/**
 * Currencies Stripe counts in whole units (https://docs.stripe.com/currencies#zero-decimal). ISK and UGX
 * are zero-decimal too, but Stripe still expects them as two-decimal values ending in 00, so they're not
 * listed here. Every other currency Stripe supports has two decimals.
 */
const ZERO_DECIMAL = new Set<string>(["BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG", "RWF", "VND", "VUV", "XAF", "XOF", "XPF"])

function stripeDecimals(currency: CurrencyCode): number {
  return ZERO_DECIMAL.has(currency) ? 0 : 2
}

/** YaroPay minor units (ISO 4217 decimals) to the amount Stripe expects. */
export function toStripeAmount(minor: number, currency: CurrencyCode): number {
  const shift = stripeDecimals(currency) - minorUnitExponent(currency)
  if (shift >= 0) return minor * 10 ** shift
  const factor = 10 ** -shift
  if (minor % factor !== 0) throw new GatewayError(`${NAME} charges ${currency} in whole units, without fractions`, "request")
  return minor / factor
}

/** A Stripe amount back to YaroPay minor units. */
export function fromStripeAmount(amount: number, currency: CurrencyCode): number {
  const shift = minorUnitExponent(currency) - stripeDecimals(currency)
  return shift >= 0 ? Math.round(amount * 10 ** shift) : Math.round(amount / 10 ** -shift)
}

/** Stripe metadata holds up to 50 string values; keys up to 40 characters, values up to 500. */
function stripeMetadata(metadata: Record<string, unknown>, reference: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(metadata)) {
    if (Object.keys(out).length >= 49) break
    if (key.length > 40 || value === undefined || value === null || key === "yaropay_reference") continue
    out[key] = (typeof value === "string" ? value : JSON.stringify(value)).slice(0, 500)
  }
  out.yaropay_reference = reference
  return out
}

function withQuery(url: string, query: string): string {
  return `${url}${url.includes("?") ? "&" : "?"}${query}`
}

interface StripeCharge {
  created?: number
  payment_method_details?: { type?: string }
  balance_transaction?: { fee?: number; currency?: string } | string | null
}

interface StripePaymentIntent {
  id: string
  status?: string
  last_payment_error?: { message?: string } | null
  latest_charge?: StripeCharge | string | null
}

interface StripeSession {
  id: string
  status?: string | null
  payment_status?: string
  amount_total?: number | null
  currency?: string | null
  client_reference_id?: string | null
  customer_email?: string | null
  customer_details?: { email?: string | null; name?: string | null } | null
  payment_intent?: StripePaymentIntent | string | null
  metadata?: Record<string, string> | null
  created?: number
}

const CHANNELS: Record<string, PaymentChannel> = {
  card: "card",
  customer_balance: "bank_transfer",
  us_bank_account: "bank",
  sepa_debit: "bank",
  bacs_debit: "bank",
  acss_debit: "bank",
  au_becs_debit: "bank",
}

function sessionStatus(s: StripeSession): TransactionStatus {
  if (s.payment_status === "paid") return "success"
  if (s.status === "expired") return "abandoned"
  const pi = typeof s.payment_intent === "object" && s.payment_intent ? s.payment_intent : null
  // A completed session that is still unpaid is an asynchronous payment (a bank debit, for example):
  // it stays pending until Stripe reports the outcome, and fails if the payment intent was given up.
  if (s.status === "complete" && pi && (pi.status === "canceled" || pi.status === "requires_payment_method")) return "failed"
  return "pending"
}

function toPayment(s: StripeSession): GatewayPayment {
  const currency = asCurrency(s.currency)
  const status = sessionStatus(s)
  const pi = typeof s.payment_intent === "object" && s.payment_intent ? s.payment_intent : null
  const charge = pi && typeof pi.latest_charge === "object" && pi.latest_charge ? pi.latest_charge : null
  const balance = charge && typeof charge.balance_transaction === "object" && charge.balance_transaction ? charge.balance_transaction : null
  // The fee is in the account's settlement currency; only report it when that's the payment's currency.
  const fee = balance?.fee != null && String(balance.currency ?? "").toUpperCase() === currency ? fromStripeAmount(balance.fee, currency) : 0
  const methodType = charge?.payment_method_details?.type ?? ""
  return {
    reference: s.client_reference_id ?? s.metadata?.yaropay_reference ?? "",
    status,
    amount: fromStripeAmount(Number(s.amount_total ?? 0), currency),
    currency,
    channel: CHANNELS[methodType] ?? null,
    fee,
    paidAt: status === "success" && charge?.created ? new Date(charge.created * 1000).toISOString() : null,
    gatewayTransactionId: pi?.id ?? (typeof s.payment_intent === "string" ? s.payment_intent : null),
    customer: { email: s.customer_details?.email ?? s.customer_email ?? "", name: s.customer_details?.name ?? "" },
    metadata: { ...(s.metadata ?? {}) },
    message: pi?.last_payment_error?.message ?? null,
  }
}

const EXPAND = "expand[]=payment_intent.latest_charge.balance_transaction"
const versionHeader = { "Stripe-Version": STRIPE_VERSION }

/** Parses `t=...,v1=...,v1=...` and ignores every other entry (v0, secret, destination, payload). */
function parseSignatureHeader(value: string): { timestamp: number | null; signatures: string[] } {
  let timestamp: number | null = null
  const signatures: string[] = []
  for (const part of value.split(",")) {
    const i = part.indexOf("=")
    if (i < 0) continue
    const key = part.slice(0, i).trim()
    const v = part.slice(i + 1).trim()
    if (key === "t" && /^\d+$/.test(v)) timestamp = Number(v)
    else if (key === "v1" && v) signatures.push(v)
  }
  return { timestamp, signatures }
}

const SESSION_EVENTS: Record<string, TransactionStatus | null> = {
  "checkout.session.completed": null, // success when already paid; otherwise an async payment is on its way
  "checkout.session.async_payment_succeeded": "success",
  "checkout.session.async_payment_failed": "failed",
  "checkout.session.expired": "abandoned",
}

export const stripeAdapter: GatewayAdapter = {
  id: "stripe",
  name: NAME,
  // A customer who uses Checkout's back link lands on the cancel URL, but the session stays open until it
  // expires, so verify can't prove the cancellation. YaroPay's signed cancel link does.
  confirmsCancellation: false,

  async initialize(ctx, creds, p) {
    const metadata = stripeMetadata(p.metadata, p.reference)
    const form: Record<string, string> = {
      mode: "payment",
      client_reference_id: p.reference,
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": p.currency.toLowerCase(),
      "line_items[0][price_data][unit_amount]": String(toStripeAmount(p.amount, p.currency)),
      "line_items[0][price_data][product_data][name]": p.title.slice(0, 250) || "Payment",
      success_url: withQuery(p.callbackUrl, `reference=${encodeURIComponent(p.reference)}&session_id={CHECKOUT_SESSION_ID}`),
    }
    if (p.cancelUrl) form.cancel_url = withQuery(p.cancelUrl, `reference=${encodeURIComponent(p.reference)}`)
    if (p.email) form.customer_email = p.email
    for (const [k, v] of Object.entries(metadata)) {
      form[`metadata[${k}]`] = v
      form[`payment_intent_data[metadata][${k}]`] = v
    }
    const { body } = await gatewayRequest<StripeSession & { url?: string }>(ctx, NAME, "/v1/checkout/sessions", {
      method: "POST",
      secret: creds.secretKey,
      form,
      // A retried request for the same payment returns the same session instead of a second one.
      headers: { ...versionHeader, "Idempotency-Key": `yaropay-${p.reference}` },
    })
    if (!body?.url || !body.id) throw new GatewayError(`${NAME}: could not create the Checkout Session`, "request")
    return { authorizationUrl: body.url, checkoutId: body.id }
  },

  async verify(ctx, creds, ref) {
    let session: StripeSession | null = null
    if (ref.checkoutId?.startsWith("cs_")) {
      const { status, body } = await gatewayRequest<StripeSession>(ctx, NAME, `/v1/checkout/sessions/${encodeURIComponent(ref.checkoutId)}?${EXPAND}`, {
        secret: creds.secretKey,
        headers: versionHeader,
      })
      if (status === 404 || !body?.id) return null
      session = body
    } else if (ref.gatewayTransactionId?.startsWith("pi_")) {
      // Without the session id (a payment YaroPay didn't start), find the session by its payment intent.
      const { body } = await gatewayRequest<{ data?: StripeSession[] }>(
        ctx,
        NAME,
        `/v1/checkout/sessions?payment_intent=${encodeURIComponent(ref.gatewayTransactionId)}&limit=1&expand[]=data.payment_intent.latest_charge.balance_transaction`,
        { secret: creds.secretKey, headers: versionHeader },
      )
      session = body?.data?.[0] ?? null
    }
    if (!session) return null
    const payment = toPayment(session)
    if (payment.reference && payment.reference !== ref.reference) return null
    return { ...payment, reference: ref.reference }
  },

  async verifySignature(_ctx, creds, rawBody, headers) {
    const secret = creds.webhookSecret
    const value = header(headers, "stripe-signature")
    if (!secret || !value) return false
    const { timestamp, signatures } = parseSignatureHeader(value)
    if (timestamp === null || signatures.length === 0) return false
    const expected = hmacHex("sha256", secret, Buffer.concat([Buffer.from(`${timestamp}.`), rawBody]))
    if (!signatures.some((s) => safeEqual(expected, s.toLowerCase()))) return false
    return Math.abs(Date.now() / 1000 - timestamp) <= SIGNATURE_TOLERANCE_SECONDS
  },

  parseWebhook(body): ParsedWebhook {
    const b = asRecord(body)
    const type = String(b.type ?? "unknown")
    const object = asRecord(asRecord(b.data).object)
    const metadata = asRecord(object.metadata)
    const reference = (typeof object.client_reference_id === "string" && object.client_reference_id) || (typeof metadata.yaropay_reference === "string" && metadata.yaropay_reference) || null
    if (type in SESSION_EVENTS && object.object === "checkout.session") {
      const session = object as unknown as StripeSession
      const status = SESSION_EVENTS[type] ?? (session.payment_status === "paid" ? "success" : null)
      if (!status || !reference) return { type, reference, payment: null, metadata }
      // Events carry the session without its charge; YaroPay confirms successes with verify, which
      // reads the fee and the time of payment.
      const p = toPayment(session)
      return {
        type,
        reference,
        payment: { reference, status, amount: p.amount, currency: p.currency, channel: null, fee: 0, paidAt: null, gatewayTransactionId: p.gatewayTransactionId, customer: p.customer, metadata: p.metadata },
        metadata,
      }
    }
    return { type, reference, payment: null, metadata }
  },

  parseCallback(q): CallbackParams {
    return {
      reference: q.reference || null,
      outcome: q.outcome === "cancelled" ? "cancelled" : null,
      gatewayTransactionId: null,
      checkoutId: q.session_id?.startsWith("cs_") ? q.session_id : null,
    }
  },

  async testConnection(ctx, creds) {
    try {
      await gatewayRequest(ctx, NAME, "/v1/balance", { secret: creds.secretKey, headers: versionHeader })
      return { ok: true, message: `${NAME} accepted the secret key.` }
    } catch (e) {
      return { ok: false, message: (e as Error).message }
    }
  },
}
