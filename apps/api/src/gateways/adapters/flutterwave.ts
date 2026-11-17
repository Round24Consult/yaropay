import type { PaymentChannel, TransactionStatus } from "@yaropay/core/types"
import { safeEqual } from "../../common/crypto.js"
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
  header,
  type InitializeParams,
  type ParsedWebhook,
} from "./types.js"

interface FlwEnvelope<T> {
  status: "success" | "error"
  message: string
  data: T
}

interface FlwTransaction {
  id: number
  tx_ref: string
  amount: number
  currency: string
  status: string
  payment_type?: string
  app_fee?: number
  created_at?: string
  processor_response?: string
  customer?: { email?: string; name?: string }
  meta?: unknown
}

export function flutterwaveStatus(s: string): TransactionStatus {
  switch (s) {
    case "successful":
    case "completed":
      return "success"
    case "failed":
      return "failed"
    case "cancelled":
      return "abandoned"
    default:
      return "pending"
  }
}

export function flutterwaveChannel(t: string | undefined): PaymentChannel | null {
  if (!t) return null
  if (t === "card") return "card"
  if (t === "bank_transfer" || t === "banktransfer") return "bank_transfer"
  if (t === "ussd") return "ussd"
  if (t.startsWith("mobilemoney") || t.startsWith("mobile_money") || t === "mpesa") return "mobile_money"
  if (t === "account" || t === "bank") return "bank"
  if (t === "qr" || t === "nqr") return "qr"
  return null
}

const PAYMENT_OPTIONS: Record<PaymentChannel, string> = {
  card: "card",
  bank_transfer: "banktransfer",
  ussd: "ussd",
  mobile_money: "mobilemoneyghana,mobilemoneyuganda,mobilemoneyrwanda,mobilemoneyzambia,mpesa",
  bank: "account",
  qr: "nqr",
}

/** Flutterwave amounts are in major units; YaroPay stores minor units. */
const toMinor = (major: unknown) => Math.round(Number(major ?? 0) * 100)
const toMajor = (minor: number) => minor / 100

function toPayment(t: FlwTransaction): GatewayPayment {
  const status = flutterwaveStatus(t.status)
  return {
    reference: t.tx_ref,
    status,
    amount: toMinor(t.amount),
    currency: asCurrency(t.currency),
    channel: flutterwaveChannel(t.payment_type),
    fee: toMinor(t.app_fee),
    paidAt: status === "success" ? (t.created_at ?? null) : null,
    gatewayTransactionId: t.id != null ? String(t.id) : null,
    customer: { email: t.customer?.email ?? "", name: t.customer?.name ?? "" },
    metadata: asRecord(t.meta),
    message: t.processor_response ?? null,
  }
}

/** Flutterwave `meta` only holds flat values. */
function flatMeta(meta: Record<string, unknown>): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {}
  for (const [k, v] of Object.entries(meta)) {
    if (v === null || v === undefined) continue
    out[k] = typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? v : JSON.stringify(v)
  }
  return out
}

export const flutterwaveAdapter: GatewayAdapter = {
  confirmsCancellation: true,
  id: "flutterwave",
  name: "Flutterwave",

  async initialize(ctx: AdapterContext, creds: Credentials, p: InitializeParams) {
    const { body } = await gatewayRequest<FlwEnvelope<{ link: string }>>(ctx, "Flutterwave", "/v3/payments", {
      method: "POST",
      secret: creds.secretKey,
      body: {
        tx_ref: p.reference,
        amount: toMajor(p.amount),
        currency: p.currency,
        redirect_url: p.callbackUrl,
        customer: { email: p.email, ...(p.name ? { name: p.name } : {}) },
        meta: flatMeta(p.metadata),
        customizations: { title: p.title },
        ...(p.channels?.length ? { payment_options: [...new Set(p.channels.map((c) => PAYMENT_OPTIONS[c]))].join(",") } : {}),
      },
    })
    if (body?.status !== "success" || !body.data?.link) {
      throw new GatewayError(`Flutterwave: ${body?.message ?? "could not start the payment"}`, "request")
    }
    return { authorizationUrl: body.data.link }
  },

  async verify(ctx, creds, ref) {
    const path = ref.gatewayTransactionId
      ? `/v3/transactions/${encodeURIComponent(ref.gatewayTransactionId)}/verify`
      : `/v3/transactions/verify_by_reference?tx_ref=${encodeURIComponent(ref.reference)}`
    const { status, body } = await gatewayRequest<FlwEnvelope<FlwTransaction | null>>(ctx, "Flutterwave", path, {
      secret: creds.secretKey,
    })
    if (status === 404 || body?.status !== "success" || !body.data) return null
    // A transaction id from the query string must belong to the reference we expect.
    if (body.data.tx_ref !== ref.reference) return null
    return toPayment(body.data)
  },

  /** Flutterwave echoes the secret hash you configured in the `verif-hash` header. */
  verifySignature(creds, _rawBody, headers) {
    const given = header(headers, "verif-hash")
    if (!given || !creds.secretHash) return false
    return safeEqual(given, creds.secretHash)
  },

  parseWebhook(body): ParsedWebhook {
    const b = asRecord(body)
    const type = String(b.event ?? b["event.type"] ?? "unknown")
    const data = asRecord(b.data)
    const metadata = { ...asRecord(data.meta), ...asRecord(b.meta_data) }
    const reference = typeof data.tx_ref === "string" ? data.tx_ref : null
    if (type === "charge.completed" && reference) {
      const payment = toPayment({ ...(data as unknown as FlwTransaction), meta: metadata })
      return { type, reference, payment, metadata }
    }
    return { type, reference, payment: null, metadata }
  },

  parseCallback(q): CallbackParams {
    const s = q.status
    return {
      reference: q.tx_ref || null,
      outcome: s === "cancelled" ? "cancelled" : s === "failed" ? "failed" : s === "successful" || s === "completed" ? "successful" : null,
      gatewayTransactionId: q.transaction_id || null,
    }
  },

  async testConnection(ctx, creds) {
    try {
      await gatewayRequest(ctx, "Flutterwave", "/v3/balances", { secret: creds.secretKey })
      return { ok: true, message: "Flutterwave accepted the secret key." }
    } catch (e) {
      return { ok: false, message: (e as Error).message }
    }
  },
}
