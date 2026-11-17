import type { ConnectionTestResult } from "@yaropay/core/api"
import type { CurrencyCode, GatewayId, PaymentChannel, TransactionStatus } from "@yaropay/core/types"
import type { FetchFn } from "../../common/http.js"

export type Credentials = Record<string, string>

export interface InitializeParams {
  reference: string
  /** Minor units. */
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
  authorizationUrl: string
  accessCode?: string
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
}

export interface CallbackParams {
  reference: string | null
  /** What the gateway says happened, before YaroPay verifies it. */
  outcome: "cancelled" | "failed" | "successful" | null
  gatewayTransactionId: string | null
}

export interface AdapterContext {
  fetch: FetchFn
  baseUrl: string
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
  initialize(ctx: AdapterContext, creds: Credentials, params: InitializeParams): Promise<InitializeResult>
  /** Null when the gateway has no such payment. */
  verify(ctx: AdapterContext, creds: Credentials, ref: { reference: string; gatewayTransactionId?: string | null }): Promise<GatewayPayment | null>
  verifySignature(creds: Credentials, rawBody: Buffer, headers: Record<string, string | string[] | undefined>): boolean
  parseWebhook(body: unknown): ParsedWebhook
  parseCallback(query: Record<string, string | undefined>): CallbackParams
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

export function header(headers: Record<string, string | string[] | undefined>, name: string): string {
  const v = headers[name.toLowerCase()]
  return (Array.isArray(v) ? v[0] : v) ?? ""
}

/** JSON request with a timeout. Non-2xx answers become GatewayError. */
export async function gatewayRequest<T>(
  ctx: AdapterContext,
  gatewayName: string,
  path: string,
  init: { method?: "GET" | "POST"; secret: string; body?: unknown },
): Promise<{ status: number; body: T }> {
  let res: Response
  try {
    res = await ctx.fetch(`${ctx.baseUrl}${path}`, {
      method: init.method ?? "GET",
      headers: {
        authorization: `Bearer ${init.secret}`,
        accept: "application/json",
        ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
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
    const message = (body as { message?: string } | null)?.message ?? `HTTP ${res.status}`
    throw new GatewayError(`${gatewayName}: ${message}`, "request", res.status)
  }
  return { status: res.status, body: body as T }
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

export const CURRENCIES = new Set(["NGN", "USD", "GHS", "KES", "ZAR"])
export function asCurrency(v: unknown, fallback: CurrencyCode = "NGN"): CurrencyCode {
  const c = String(v ?? "").toUpperCase()
  return (CURRENCIES.has(c) ? c : fallback) as CurrencyCode
}
