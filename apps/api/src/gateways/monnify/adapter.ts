/**
 * Monnify one-time payments. Written from Monnify's documentation and official SDKs (developers.monnify.com
 * sits behind a bot check, so the endpoints and fields were confirmed in Monnify's own repositories):
 * - Authentication, init-transaction and transaction status:
 *   https://developers.monnify.com/docs/collections/one-time-payment and
 *   https://github.com/Monnify/Monnify-Nodejs-lib (src/base_api.js, src/collections/transaction.js,
 *   validators/transactionValidator.js, README.md)
 * - Status and payment-method values: https://github.com/Monnify/AndroidSDK (README.md) and
 *   https://github.com/Monnify/Monnify-java-sdk (models/transaction)
 * - Webhook signature and event types: https://developers.monnify.com/docs/webhooks,
 *   https://github.com/Monnify/Monnify-PHP-SDK (src/Webhooks, src/Enums/WebhookEventType.php) and
 *   https://github.com/Monnify/monnify-django-webhook
 *
 * Monnify counts amounts in naira (major units). YaroPay's reference is Monnify's paymentReference; Monnify's
 * own transactionReference is the checkout id.
 */
import { type CurrencyCode, toMajorUnits, toMinorUnits } from "@yaropay/core/currencies"
import type { PaymentChannel, TransactionStatus } from "@yaropay/core/types"
import { hmacHex, safeEqual, sha256 } from "../../common/crypto.js"
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

const NAME = "Monnify"

interface MonnifyEnvelope<T> {
  requestSuccessful?: boolean
  responseMessage?: string
  responseCode?: string
  responseBody?: T
}

interface MonnifyTransaction {
  transactionReference?: string
  paymentReference?: string
  amountPaid?: number | string
  totalPayable?: number | string
  settlementAmount?: number | string
  paidOn?: string | null
  paymentStatus?: string
  paymentDescription?: string
  currency?: string
  paymentMethod?: string
  customer?: { email?: string; name?: string }
  metaData?: Record<string, unknown> | null
}

const tokens = new Map<string, { token: string; expiresAt: number }>()

/** Forgets cached access tokens (tests). */
export function clearMonnifyTokens() {
  tokens.clear()
}

async function accessToken(ctx: AdapterContext, creds: Credentials, fresh = false): Promise<string> {
  const key = `${ctx.baseUrl}|${creds.apiKey ?? ""}|${sha256(creds.secretKey ?? "")}`
  const cached = tokens.get(key)
  if (!fresh && cached && cached.expiresAt > Date.now()) return cached.token
  const { body } = await gatewayRequest<MonnifyEnvelope<{ accessToken?: string; expiresIn?: number }>>(ctx, NAME, "/api/v1/auth/login", {
    method: "POST",
    auth: { basic: { username: creds.apiKey ?? "", password: creds.secretKey ?? "" } },
  })
  const token = body?.responseBody?.accessToken
  if (!body?.requestSuccessful || !token) throw new GatewayError(`${NAME} rejected the API key and secret key`, "auth")
  // Refresh a minute early so a token never expires mid-request.
  const lifetime = Math.max(60, Number(body.responseBody?.expiresIn ?? 300) - 60)
  tokens.set(key, { token, expiresAt: Date.now() + lifetime * 1000 })
  return token
}

/** An authenticated API call; a cached token Monnify no longer accepts is replaced once. */
async function call<T>(ctx: AdapterContext, creds: Credentials, path: string, init: Omit<GatewayRequestInit, "auth" | "secret"> = {}) {
  const attempt = async (fresh: boolean) => gatewayRequest<MonnifyEnvelope<T>>(ctx, NAME, path, { ...init, auth: { bearer: await accessToken(ctx, creds, fresh) } })
  try {
    return await attempt(false)
  } catch (e) {
    if (e instanceof GatewayError && e.kind === "auth") return attempt(true)
    throw e
  }
}

export function monnifyStatus(s: string | undefined): TransactionStatus {
  switch ((s ?? "").toUpperCase()) {
    case "PAID":
    case "OVERPAID":
      return "success"
    case "PARTIALLY_PAID":
    case "FAILED":
      return "failed"
    case "REVERSED":
      return "reversed"
    case "EXPIRED":
    case "ABANDONED":
    case "CANCELLED":
    case "USER_CANCELLED":
      return "abandoned"
    default:
      return "pending"
  }
}

const CHANNELS: Record<string, PaymentChannel> = { CARD: "card", ACCOUNT_TRANSFER: "bank_transfer", USSD: "ussd", DIRECT_DEBIT: "bank" }
const METHODS: Partial<Record<PaymentChannel, string>> = { card: "CARD", bank_transfer: "ACCOUNT_TRANSFER", ussd: "USSD" }

/**
 * Monnify's paidOn. Accepts ISO dates, with or without an offset (`+0000` or `+00:00`); a date with no
 * offset is read as Lagos time (UTC+1), where Monnify operates.
 */
export function monnifyDate(v: unknown): string | null {
  if (typeof v !== "string" || !v.trim()) return null
  let s = v.trim().replace(" ", "T")
  s = s.replace(/([+-]\d{2})(\d{2})$/, "$1:$2")
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(s)) s = `${s}+01:00`
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

function naira(v: unknown, currency: CurrencyCode): number {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? toMinorUnits(n, currency) : 0
}

function toPayment(t: MonnifyTransaction, reference?: string): GatewayPayment {
  const currency = asCurrency(t.currency)
  const status = monnifyStatus(t.paymentStatus)
  const paid = naira(t.amountPaid, currency)
  const amount = paid > 0 ? paid : naira(t.totalPayable, currency)
  const settled = naira(t.settlementAmount, currency)
  const partial = (t.paymentStatus ?? "").toUpperCase() === "PARTIALLY_PAID"
  return {
    reference: t.paymentReference ?? reference ?? "",
    status,
    amount,
    currency,
    channel: CHANNELS[(t.paymentMethod ?? "").toUpperCase()] ?? null,
    fee: paid > 0 && settled > 0 && settled <= paid ? paid - settled : 0,
    paidAt: status === "success" || status === "reversed" ? monnifyDate(t.paidOn) : null,
    gatewayTransactionId: t.transactionReference ?? null,
    customer: { email: t.customer?.email ?? "", name: t.customer?.name ?? "" },
    metadata: asRecord(t.metaData),
    message: partial ? "The customer paid less than the amount due. Settle the difference in Monnify." : null,
  }
}

function withQuery(url: string, query: string): string {
  return `${url}${url.includes("?") ? "&" : "?"}${query}`
}

const NOT_FOUND = /not\s*found|could not find|does not exist|no transaction/i

export const monnifyAdapter: GatewayAdapter = {
  id: "monnify",
  name: NAME,
  confirmsCancellation: false,

  async initialize(ctx, creds, p) {
    const fallbackName = p.email.split("@")[0] ?? ""
    const name = (p.name ?? "").trim().length >= 3 ? p.name!.trim() : fallbackName.length >= 3 ? fallbackName : "Customer"
    const methods = (p.channels ?? []).map((c) => METHODS[c]).filter((m): m is string => !!m)
    const { body } = await call<{ checkoutUrl?: string; transactionReference?: string }>(ctx, creds, "/api/v1/merchant/transactions/init-transaction", {
      method: "POST",
      body: {
        amount: toMajorUnits(p.amount, p.currency),
        customerName: name,
        customerEmail: p.email,
        paymentReference: p.reference,
        paymentDescription: p.title.trim().length >= 3 ? p.title.trim() : "Payment",
        currencyCode: p.currency,
        contractCode: creds.contractCode,
        redirectUrl: withQuery(p.callbackUrl, `reference=${encodeURIComponent(p.reference)}`),
        ...(methods.length ? { paymentMethods: methods } : {}),
        metaData: { ...p.metadata, yaropay_reference: p.reference },
      },
    })
    const checkoutUrl = body?.responseBody?.checkoutUrl
    if (!body?.requestSuccessful || !checkoutUrl) throw new GatewayError(`${NAME}: ${body?.responseMessage ?? "could not start the payment"}`, "request")
    return { authorizationUrl: checkoutUrl, checkoutId: body.responseBody?.transactionReference ?? null }
  },

  async verify(ctx, creds, ref) {
    try {
      const { status, body } = await call<MonnifyTransaction>(ctx, creds, `/api/v2/merchant/transactions/query?paymentReference=${encodeURIComponent(ref.reference)}`)
      if (status === 404 || !body?.requestSuccessful || !body.responseBody) return null
      const payment = toPayment(body.responseBody, ref.reference)
      return payment.reference === ref.reference ? payment : null
    } catch (e) {
      // Monnify answers an unknown reference with an error status and a "not found" message.
      if (e instanceof GatewayError && e.kind === "request" && NOT_FOUND.test(e.message)) return null
      throw e
    }
  },

  /**
   * `monnify-signature` is the HMAC-SHA512 of the body, keyed with the secret key. Monnify's samples hash
   * the raw bytes (PHP, Python) or the re-serialised JSON (Node), so both are accepted.
   */
  async verifySignature(_ctx, creds, rawBody, headers) {
    const given = header(headers, "monnify-signature").toLowerCase()
    if (!given || !creds.secretKey) return false
    if (safeEqual(hmacHex("sha512", creds.secretKey, rawBody), given)) return true
    try {
      return safeEqual(hmacHex("sha512", creds.secretKey, JSON.stringify(JSON.parse(rawBody.toString("utf8")))), given)
    } catch {
      return false
    }
  },

  parseWebhook(body): ParsedWebhook {
    const b = asRecord(body)
    const type = String(b.eventType ?? "unknown")
    const data = asRecord(b.eventData)
    const metadata = asRecord(data.metaData)
    const reference = typeof data.paymentReference === "string" && data.paymentReference ? data.paymentReference : null
    if (!reference) return { type, reference, payment: null, metadata }
    const status: TransactionStatus | null = type === "SUCCESSFUL_TRANSACTION" ? "success" : type === "REJECTED_PAYMENT" ? "failed" : type === "SUCCESSFUL_REFUND" ? "reversed" : null
    if (!status) return { type, reference, payment: null, metadata }
    const p = toPayment(data as MonnifyTransaction, reference)
    return {
      type,
      reference,
      payment: { reference, status, amount: p.amount, currency: p.currency, channel: p.channel, fee: p.fee, paidAt: status === "success" ? p.paidAt : null, gatewayTransactionId: p.gatewayTransactionId, customer: p.customer, metadata },
      metadata,
    }
  },

  parseCallback(q): CallbackParams {
    return { reference: q.reference || q.paymentReference || null, outcome: null, gatewayTransactionId: null }
  },

  async testConnection(ctx, creds) {
    try {
      await accessToken(ctx, creds, true)
      return { ok: true, message: `${NAME} accepted the API key and secret key.` }
    } catch (e) {
      return { ok: false, message: (e as Error).message }
    }
  },
}
