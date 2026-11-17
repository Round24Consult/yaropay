/**
 * PayPal Orders v2 (PayPal's hosted approval page). Written from PayPal's API documentation:
 * - Orders v2 (create, show, capture): https://developer.paypal.com/docs/api/orders/v2/ and the official
 *   OpenAPI file https://github.com/paypal/paypal-rest-api-specifications (openapi/checkout_orders_v2.json)
 * - Captures (show captured payment): https://developer.paypal.com/docs/api/payments/v2/
 * - OAuth client-credentials token: https://developer.paypal.com/api/rest/authentication/
 * - Webhook verification by API: https://developer.paypal.com/docs/api/webhooks/v1/ (verify-webhook-signature)
 *   and https://developer.paypal.com/api/rest/webhooks/rest/
 * - Event names: https://developer.paypal.com/api/rest/webhooks/event-names/
 * - Currencies and zero-decimal currencies: https://developer.paypal.com/docs/reports/reference/paypal-supported-currencies/
 *
 * YaroPay creates one order per payment (intent CAPTURE) with its reference as the purchase unit's
 * custom_id; the order id is the checkout id. Approval alone moves no money, so `finalize` captures the
 * order when the customer comes back, and YaroPay also captures it when PayPal reports the approval by
 * webhook (for customers who close the tab instead of returning).
 */
import { type CurrencyCode, minorUnitExponent, toMinorUnits } from "@yaropay/core/currencies"
import type { TransactionStatus } from "@yaropay/core/types"
import { sha256 } from "../../common/crypto.js"
import {
  type AdapterContext,
  asCurrency,
  asRecord,
  type CallbackParams,
  type Credentials,
  type GatewayAdapter,
  GatewayError,
  type GatewayPayment,
  gatewayRequest,
  type GatewayRequestInit,
  header,
  type ParsedWebhook,
} from "../kit.js"

const NAME = "PayPal"

/** Currencies PayPal accepts without decimals. Every other PayPal currency has two. */
const ZERO_DECIMAL = new Set<string>(["HUF", "JPY", "TWD"])

/** YaroPay minor units to PayPal's `value` string, refusing a fraction PayPal can't take. */
export function toPayPalValue(minor: number, currency: CurrencyCode): string {
  const decimals = ZERO_DECIMAL.has(currency) ? 0 : 2
  const shift = minorUnitExponent(currency) - decimals
  let units: number
  if (shift > 0) {
    const factor = 10 ** shift
    if (minor % factor !== 0) throw new GatewayError(`${NAME} accepts ${currency} only in whole units, without fractions`, "request")
    units = minor / factor
  } else {
    units = minor * 10 ** -shift
  }
  if (decimals === 0) return String(units)
  const digits = String(units).padStart(decimals + 1, "0")
  return `${digits.slice(0, -decimals)}.${digits.slice(-decimals)}`
}

interface Money {
  currency_code?: string
  value?: string
}

interface PayPalCapture {
  id?: string
  status?: string
  amount?: Money
  custom_id?: string
  create_time?: string
  status_details?: { reason?: string }
  seller_receivable_breakdown?: { paypal_fee?: Money }
}

interface PayPalOrder {
  id?: string
  status?: string
  purchase_units?: {
    custom_id?: string
    reference_id?: string
    amount?: Money
    payments?: { captures?: PayPalCapture[] }
  }[]
  payer?: { email_address?: string; name?: { given_name?: string; surname?: string } }
  payment_source?: {
    paypal?: { email_address?: string; name?: { given_name?: string; surname?: string } }
    card?: Record<string, unknown>
  }
  links?: { rel?: string; href?: string }[]
}

const tokens = new Map<string, { token: string; expiresAt: number }>()

/** Forgets cached access tokens (tests). */
export function clearPayPalTokens() {
  tokens.clear()
}

async function accessToken(ctx: AdapterContext, creds: Credentials, fresh = false): Promise<string> {
  const key = `${ctx.baseUrl}|${creds.clientId ?? ""}|${sha256(creds.clientSecret ?? "")}`
  const cached = tokens.get(key)
  if (!fresh && cached && cached.expiresAt > Date.now()) return cached.token
  const { body } = await gatewayRequest<{ access_token?: string; expires_in?: number }>(ctx, NAME, "/v1/oauth2/token", {
    method: "POST",
    auth: { basic: { username: creds.clientId ?? "", password: creds.clientSecret ?? "" } },
    form: { grant_type: "client_credentials" },
  })
  if (!body?.access_token) throw new GatewayError(`${NAME} did not return an access token`, "auth")
  // Refresh a minute early so a token never expires mid-request.
  const lifetime = Math.max(60, Number(body.expires_in ?? 300) - 60)
  tokens.set(key, { token: body.access_token, expiresAt: Date.now() + lifetime * 1000 })
  return body.access_token
}

/** An authenticated API call; a cached token PayPal no longer accepts is replaced once. */
async function call<T>(ctx: AdapterContext, creds: Credentials, path: string, init: Omit<GatewayRequestInit, "auth" | "secret"> = {}) {
  const attempt = async (fresh: boolean) => gatewayRequest<T>(ctx, NAME, path, { ...init, auth: { bearer: await accessToken(ctx, creds, fresh) } })
  try {
    return await attempt(false)
  } catch (e) {
    if (e instanceof GatewayError && e.kind === "auth") return attempt(true)
    throw e
  }
}

function withQuery(url: string, query: string): string {
  return `${url}${url.includes("?") ? "&" : "?"}${query}`
}

function captureStatus(s: string | undefined): TransactionStatus {
  switch (s) {
    case "COMPLETED":
    case "PARTIALLY_REFUNDED":
      return "success"
    case "DECLINED":
    case "FAILED":
      return "failed"
    case "REFUNDED":
      return "reversed"
    default:
      return "pending"
  }
}

function minor(money: Money | undefined, fallback: CurrencyCode): { amount: number; currency: CurrencyCode } {
  const currency = asCurrency(money?.currency_code, fallback)
  return { amount: toMinorUnits(Number(money?.value ?? 0), currency), currency }
}

function fromCapture(c: PayPalCapture, base: Partial<GatewayPayment> = {}): GatewayPayment {
  const { amount, currency } = minor(c.amount, base.currency ?? "USD")
  const status = captureStatus(c.status)
  const feeMoney = c.seller_receivable_breakdown?.paypal_fee
  const fee = feeMoney?.value && asCurrency(feeMoney.currency_code, currency) === currency ? toMinorUnits(Number(feeMoney.value), currency) : 0
  return {
    reference: c.custom_id ?? base.reference ?? "",
    status,
    amount,
    currency,
    channel: base.channel ?? null,
    fee,
    paidAt: status === "success" || status === "reversed" ? (c.create_time ?? null) : null,
    gatewayTransactionId: c.id ?? null,
    customer: base.customer ?? { email: "", name: "" },
    metadata: {},
    message: c.status_details?.reason ?? null,
  }
}

function fromOrder(o: PayPalOrder): GatewayPayment {
  const unit = o.purchase_units?.[0]
  const reference = unit?.custom_id ?? unit?.reference_id ?? ""
  const payer = o.payment_source?.paypal ?? o.payer
  const customer = { email: payer?.email_address ?? "", name: [payer?.name?.given_name, payer?.name?.surname].filter(Boolean).join(" ") }
  const channel = o.payment_source?.card ? ("card" as const) : null
  const capture = unit?.payments?.captures?.[0]
  if (capture) return fromCapture(capture, { reference: capture.custom_id ?? reference, customer, channel, currency: asCurrency(unit?.amount?.currency_code, "USD") })
  const { amount, currency } = minor(unit?.amount, "USD")
  // No capture yet: the customer hasn't approved the order, or approved it and it hasn't been captured.
  // A voided order will never be paid.
  const status: TransactionStatus = o.status === "VOIDED" ? "abandoned" : "pending"
  return { reference, status, amount, currency, channel, fee: 0, paidAt: null, gatewayTransactionId: o.id ?? null, customer, metadata: {}, message: null }
}

const CAPTURE_EVENTS: Record<string, TransactionStatus | null> = {
  "PAYMENT.CAPTURE.COMPLETED": "success",
  "PAYMENT.CAPTURE.PENDING": null,
  "PAYMENT.CAPTURE.DECLINED": "failed",
  "PAYMENT.CAPTURE.DENIED": "failed",
  "PAYMENT.CAPTURE.REFUNDED": "reversed",
  "PAYMENT.CAPTURE.REVERSED": "reversed",
}

const SIGNATURE_HEADERS = ["paypal-auth-algo", "paypal-cert-url", "paypal-transmission-id", "paypal-transmission-sig", "paypal-transmission-time"] as const

export const paypalAdapter: GatewayAdapter = {
  id: "paypal",
  name: NAME,
  // An unapproved order looks the same whether the customer is still on PayPal or left; only YaroPay's
  // signed cancel link proves a cancellation.
  confirmsCancellation: false,

  async initialize(ctx, creds, p) {
    const reference = encodeURIComponent(p.reference)
    const experience: Record<string, string> = {
      return_url: withQuery(p.callbackUrl, `reference=${reference}`),
      cancel_url: p.cancelUrl ? withQuery(p.cancelUrl, `reference=${reference}`) : withQuery(p.callbackUrl, `reference=${reference}&outcome=cancelled`),
      user_action: "PAY_NOW",
      shipping_preference: "NO_SHIPPING",
    }
    if (p.title) experience.brand_name = p.title.slice(0, 127)
    const { body } = await call<PayPalOrder>(ctx, creds, "/v2/checkout/orders", {
      method: "POST",
      // A retried request for the same payment returns the same order instead of a second one.
      headers: { "PayPal-Request-Id": `yaropay-${p.reference}` },
      body: {
        intent: "CAPTURE",
        purchase_units: [
          {
            reference_id: p.reference.slice(0, 256),
            custom_id: p.reference.slice(0, 127),
            description: (p.title || "Payment").slice(0, 127),
            amount: { currency_code: p.currency, value: toPayPalValue(p.amount, p.currency) },
          },
        ],
        payment_source: { paypal: { ...(p.email ? { email_address: p.email } : {}), experience_context: experience } },
      },
    })
    const link = body?.links?.find((l) => l.rel === "payer-action" || l.rel === "approve")?.href
    if (!body?.id || !link) throw new GatewayError(`${NAME}: could not create the order`, "request")
    return { authorizationUrl: link, checkoutId: body.id }
  },

  async verify(ctx, creds, ref) {
    let payment: GatewayPayment | null = null
    if (ref.checkoutId) {
      const { status, body } = await call<PayPalOrder>(ctx, creds, `/v2/checkout/orders/${encodeURIComponent(ref.checkoutId)}`)
      if (status === 404 || !body?.id) return null
      payment = fromOrder(body)
    } else if (ref.gatewayTransactionId) {
      // Without the order id (a payment YaroPay imported from a capture webhook), read the capture.
      const { status, body } = await call<PayPalCapture>(ctx, creds, `/v2/payments/captures/${encodeURIComponent(ref.gatewayTransactionId)}`)
      if (status === 404 || !body?.id) return null
      payment = fromCapture(body)
    }
    if (!payment || payment.reference !== ref.reference) return null
    return payment
  },

  /** Asks PayPal to check the signature: needs every transmission header and the webhook's id. */
  async verifySignature(ctx, creds, rawBody, headers) {
    const fields = Object.fromEntries(SIGNATURE_HEADERS.map((h) => [h.replace("paypal-", "").replaceAll("-", "_"), header(headers, h)]))
    if (!creds.webhookId || Object.values(fields).some((v) => !v)) return false
    const raw = rawBody.toString("utf8")
    try {
      JSON.parse(raw)
    } catch {
      return false
    }
    // The event goes back exactly as PayPal sent it: re-serialising it could change what PayPal signed.
    const head = JSON.stringify({ ...fields, webhook_id: creds.webhookId })
    const jsonText = `${head.slice(0, -1)},"webhook_event":${raw}}`
    const { body } = await call<{ verification_status?: string }>(ctx, creds, "/v1/notifications/verify-webhook-signature", { method: "POST", jsonText })
    return body?.verification_status === "SUCCESS"
  },

  parseWebhook(body): ParsedWebhook {
    const b = asRecord(body)
    const type = String(b.event_type ?? "unknown")
    const resource = asRecord(b.resource)
    if (type === "CHECKOUT.ORDER.APPROVED") {
      const order = resource as PayPalOrder
      const reference = order.purchase_units?.[0]?.custom_id ?? null
      return { type, reference, payment: null, metadata: {}, needsFinalize: order.id ? { checkoutId: order.id } : undefined }
    }
    if (type in CAPTURE_EVENTS) {
      const capture = resource as PayPalCapture
      const reference = capture.custom_id ?? null
      const status = CAPTURE_EVENTS[type]
      if (!reference || !status) return { type, reference, payment: null, metadata: {} }
      const { message: _ignored, ...payment } = fromCapture(capture)
      return { type, reference, payment: { ...payment, reference, status }, metadata: {} }
    }
    const reference = (typeof resource.custom_id === "string" && resource.custom_id) || (resource as PayPalOrder).purchase_units?.[0]?.custom_id || null
    return { type, reference, payment: null, metadata: {} }
  },

  parseCallback(q): CallbackParams {
    return {
      reference: q.reference || null,
      outcome: q.outcome === "cancelled" ? "cancelled" : null,
      gatewayTransactionId: null,
      // PayPal adds the order id as `token` when it sends the customer back.
      checkoutId: q.token || null,
    }
  },

  /** Captures the approved order. Safe to repeat: the request id makes PayPal return the first capture. */
  async finalize(ctx, creds, params) {
    if (!params.checkoutId) return
    try {
      await call(ctx, creds, `/v2/checkout/orders/${encodeURIComponent(params.checkoutId)}/capture`, {
        method: "POST",
        body: {},
        headers: { "PayPal-Request-Id": `yaropay-capture-${params.reference}`, Prefer: "return=minimal" },
      })
    } catch (e) {
      // 422: already captured, or not approved yet. Either way verify reports where the payment stands.
      if (e instanceof GatewayError && e.status === 422) return
      throw e
    }
  },

  async testConnection(ctx, creds) {
    try {
      await accessToken(ctx, creds, true)
      return { ok: true, message: `${NAME} accepted the client ID and secret.` }
    } catch (e) {
      return { ok: false, message: (e as Error).message }
    }
  },
}
