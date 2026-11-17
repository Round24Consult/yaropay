/**
 * The gateway kit: what every gateway adapter implements and the helpers they share. An adapter lives in
 * apps/api/src/gateways/<id>/adapter.ts, next to its tests and recorded fixtures, and is registered in
 * ./adapters.ts. Write adapters from the gateway's official API documentation only.
 */
import type { ConnectionTestResult } from "@yaropay/core/api"
import { type CurrencyCode, isCurrencyCode } from "@yaropay/core/currencies"
import type { GatewayId, Mode, PaymentChannel, TransactionStatus } from "@yaropay/core/types"
import type { FetchFn } from "../common/http.js"

export type Credentials = Record<string, string>
export type HeaderMap = Record<string, string | string[] | undefined>

export interface InitializeParams {
  reference: string
  /** Minor units of `currency` (see @yaropay/core/currencies for each currency's decimal places). */
  amount: number
  currency: CurrencyCode
  email: string
  name?: string
  callbackUrl: string
  cancelUrl: string | null
  metadata: Record<string, unknown>
  channels?: PaymentChannel[]
  title: string
}

export interface InitializeResult {
  /** Where the customer goes to pay. */
  authorizationUrl: string
  accessCode?: string
  /**
   * The gateway's own id for the checkout it just created, when verifying or completing the payment
   * needs it: a Stripe Checkout Session, a PayPal order, a crypto invoice. YaroPay stores it on the
   * transaction and passes it back to `verify` and `finalize`.
   */
  checkoutId?: string | null
}

/** Identifies a payment when asking the gateway about it. */
export interface PaymentRef {
  reference: string
  gatewayTransactionId?: string | null
  /** What `initialize` returned as `checkoutId`, if anything. */
  checkoutId?: string | null
}

/** A payment as the gateway reports it, normalised. Money in minor units. */
export interface GatewayPayment {
  reference: string
  status: TransactionStatus
  amount: number
  currency: CurrencyCode
  channel: PaymentChannel | null
  fee: number
  paidAt: string | null
  gatewayTransactionId: string | null
  customer: { email: string; name: string }
  metadata: Record<string, unknown>
  message: string | null
}

export interface ParsedWebhook {
  type: string
  reference: string | null
  /** Set when the event moves a payment to a new status. */
  payment: Omit<GatewayPayment, "message"> | null
  metadata: Record<string, unknown>
  /**
   * Set when the customer approved a payment that still needs completing, such as PayPal's
   * CHECKOUT.ORDER.APPROVED. YaroPay calls the adapter's `finalize` for the payment, then checks it, so a
   * customer who closes the tab instead of returning is still charged.
   */
  needsFinalize?: { checkoutId: string | null }
}

export interface CallbackParams {
  reference: string | null
  /** What the gateway says happened, before YaroPay verifies it. */
  outcome: "cancelled" | "failed" | "successful" | null
  gatewayTransactionId: string | null
  /** The checkout id, when the gateway puts it on the return URL (PayPal's `token`, for example). */
  checkoutId?: string | null
}

export interface FinalizeParams extends PaymentRef {
  /** The query string the gateway sent the customer back with. */
  query: Record<string, string | undefined>
}

export interface AdapterContext {
  fetch: FetchFn
  /** The API base URL for this account's mode: the definition's, or the operator's `<ID>_API_URL`. */
  baseUrl: string
  mode: Mode
  timeoutMs: number
}

export interface GatewayAdapter {
  readonly id: GatewayId
  readonly name: string
  /**
   * Whether `verify` can prove a checkout was cancelled. Flutterwave reports "cancelled" only when the
   * customer cancelled; Paystack reports every unpaid payment as "abandoned", even one still in progress.
   */
  readonly confirmsCancellation: boolean
  /** Creates the checkout. Throw GatewayError when the gateway refuses. */
  initialize(ctx: AdapterContext, creds: Credentials, params: InitializeParams): Promise<InitializeResult>
  /** Asks the gateway for the payment's current state. Null when the gateway has no such payment. */
  verify(ctx: AdapterContext, creds: Credentials, ref: PaymentRef): Promise<GatewayPayment | null>
  /**
   * Whether an incoming webhook really comes from the gateway. Most gateways sign the raw body (an HMAC
   * header); some need an API call to check it (PayPal), which is why this is async and gets the context.
   */
  verifySignature(ctx: AdapterContext, creds: Credentials, rawBody: Buffer, headers: HeaderMap): Promise<boolean>
  parseWebhook(body: unknown): ParsedWebhook
  parseCallback(query: Record<string, string | undefined>): CallbackParams
  /**
   * Optional. Completes a payment the customer approved on the gateway's page, for gateways where approval
   * alone doesn't move money: PayPal has to capture an approved order. Called when the customer comes back,
   * before `verify`. Must be safe to call twice (the customer can reload the page); throw only when the
   * gateway refuses, and `verify` will then report what happened.
   */
  finalize?(ctx: AdapterContext, creds: Credentials, params: FinalizeParams): Promise<void>
  testConnection(ctx: AdapterContext, creds: Credentials): Promise<ConnectionTestResult>
}

export class GatewayError extends Error {
  constructor(
    message: string,
    readonly kind: "auth" | "request" | "network",
    readonly status: number | null = null,
  ) {
    super(message)
  }
}

export function header(headers: HeaderMap, name: string): string {
  const v = headers[name.toLowerCase()]
  return (Array.isArray(v) ? v[0] : v) ?? ""
}

export interface GatewayRequestInit {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"
  /** Bearer token: the usual secret key. Shorthand for `auth: { bearer }`. */
  secret?: string
  /** Bearer token, HTTP Basic credentials, or nothing. Wins over `secret`. */
  auth?: { bearer: string } | { basic: { username: string; password: string } } | null
  /** Sent as JSON. */
  body?: unknown
  /** Sent as application/x-www-form-urlencoded instead of JSON (Stripe, OAuth token endpoints). */
  form?: Record<string, string>
  /** Sent as JSON exactly as given, for a body that must keep the bytes the gateway signed (PayPal's webhook check). */
  jsonText?: string
  headers?: Record<string, string>
}

function authHeader(init: GatewayRequestInit): Record<string, string> {
  const auth = init.auth !== undefined ? init.auth : init.secret !== undefined ? { bearer: init.secret } : null
  if (!auth) return {}
  if ("bearer" in auth) return { authorization: `Bearer ${auth.bearer}` }
  return { authorization: `Basic ${Buffer.from(`${auth.basic.username}:${auth.basic.password}`).toString("base64")}` }
}

/** HTTP request to the gateway's API with a timeout. 401/403 and other non-2xx answers (except 404) become GatewayError. */
export async function gatewayRequest<T>(ctx: AdapterContext, gatewayName: string, path: string, init: GatewayRequestInit): Promise<{ status: number; body: T }> {
  let res: Response
  const form = init.form !== undefined ? new URLSearchParams(init.form).toString() : undefined
  try {
    res = await ctx.fetch(`${ctx.baseUrl}${path}`, {
      method: init.method ?? "GET",
      headers: {
        ...authHeader(init),
        accept: "application/json",
        ...(form !== undefined ? { "content-type": "application/x-www-form-urlencoded" } : init.body !== undefined || init.jsonText !== undefined ? { "content-type": "application/json" } : {}),
        ...init.headers,
      },
      body: form ?? init.jsonText ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined),
      signal: AbortSignal.timeout(ctx.timeoutMs),
    })
  } catch (e) {
    const timeout = (e as Error).name === "TimeoutError"
    throw new GatewayError(timeout ? `${gatewayName} did not answer in time` : `Could not reach ${gatewayName}`, "network")
  }
  const text = await res.text()
  let body: unknown = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = { message: text.slice(0, 200) }
  }
  if (res.status === 401 || res.status === 403) {
    throw new GatewayError(`${gatewayName} rejected the secret key`, "auth", res.status)
  }
  if (!res.ok && res.status !== 404) {
    throw new GatewayError(`${gatewayName}: ${errorMessage(body) ?? `HTTP ${res.status}`}`, "request", res.status)
  }
  return { status: res.status, body: body as T }
}

/**
 * The human-readable error in a gateway's error body. Gateways put it in different places: `message`
 * (Paystack, Flutterwave, PayPal), `error.message` (Stripe), `error_description` (OAuth token endpoints),
 * `responseMessage` (Monnify).
 */
export function errorMessage(body: unknown): string | null {
  const b = asRecord(body)
  const candidates = [b.message, asRecord(b.error).message, b.error_description, b.responseMessage, typeof b.error === "string" ? b.error : null]
  for (const c of candidates) if (typeof c === "string" && c.trim()) return c.trim().slice(0, 300)
  return null
}

export function asRecord(v: unknown): Record<string, unknown> {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>
  if (typeof v === "string" && v.trim().startsWith("{")) {
    try {
      return asRecord(JSON.parse(v))
    } catch {
      return {}
    }
  }
  return {}
}

/** An ISO 4217 code from a gateway payload, or the fallback when it isn't one. */
export function asCurrency(v: unknown, fallback: CurrencyCode = "NGN"): CurrencyCode {
  const c = String(v ?? "").toUpperCase()
  return isCurrencyCode(c) ? c : fallback
}
