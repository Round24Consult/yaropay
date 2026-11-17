import type { PaymentChannel, TransactionStatus } from "@yaropay/core/types"
import { hmacHex, safeEqual } from "../../common/crypto.js"
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

interface PaystackEnvelope<T> {
  status: boolean
  message: string
  data: T
}

interface PaystackTransaction {
  id: number
  status: string
  reference: string
  amount: number
  currency: string
  channel?: string
  fees?: number | null
  paid_at?: string | null
  paidAt?: string | null
  gateway_response?: string
  customer?: { email?: string; first_name?: string | null; last_name?: string | null }
  metadata?: unknown
}

const CHANNELS = new Set<PaymentChannel>(["card", "bank_transfer", "ussd", "mobile_money", "bank", "qr"])

export function paystackStatus(s: string): TransactionStatus {
  switch (s) {
    case "success":
      return "success"
    case "failed":
      return "failed"
    case "abandoned":
      return "abandoned"
    case "reversed":
      return "reversed"
    default:
      return "pending"
  }
}

function toPayment(t: PaystackTransaction): GatewayPayment {
  const name = [t.customer?.first_name, t.customer?.last_name].filter(Boolean).join(" ")
  const channel = (t.channel && CHANNELS.has(t.channel as PaymentChannel) ? t.channel : null) as PaymentChannel | null
  const status = paystackStatus(t.status)
  return {
    reference: t.reference,
    status,
    amount: Number(t.amount),
    currency: asCurrency(t.currency),
    channel,
    fee: Number(t.fees ?? 0),
    paidAt: status === "success" || status === "reversed" ? (t.paid_at ?? t.paidAt ?? null) : null,
    gatewayTransactionId: t.id != null ? String(t.id) : null,
    customer: { email: t.customer?.email ?? "", name },
    metadata: asRecord(t.metadata),
    message: t.gateway_response ?? null,
  }
}

export const paystackAdapter: GatewayAdapter = {
  confirmsCancellation: false,
  id: "paystack",
  name: "Paystack",

  async initialize(ctx: AdapterContext, creds: Credentials, p: InitializeParams) {
    const { body } = await gatewayRequest<PaystackEnvelope<{ authorization_url: string; access_code: string }>>(
      ctx,
      "Paystack",
      "/transaction/initialize",
      {
        method: "POST",
        secret: creds.secretKey,
        body: {
          email: p.email,
          amount: p.amount,
          currency: p.currency,
          reference: p.reference,
          callback_url: p.callbackUrl,
          ...(p.channels?.length ? { channels: p.channels } : {}),
          metadata: { ...p.metadata, ...(p.cancelUrl ? { cancel_action: p.cancelUrl } : {}) },
        },
      },
    )
    if (!body?.status || !body.data?.authorization_url) {
      throw new GatewayError(`Paystack: ${body?.message ?? "could not start the payment"}`, "request")
    }
    return { authorizationUrl: body.data.authorization_url, accessCode: body.data.access_code }
  },

  async verify(ctx, creds, ref) {
    const { status, body } = await gatewayRequest<PaystackEnvelope<PaystackTransaction>>(
      ctx,
      "Paystack",
      `/transaction/verify/${encodeURIComponent(ref.reference)}`,
      { secret: creds.secretKey },
    )
    if (status === 404 || !body?.status || !body.data) return null
    return toPayment(body.data)
  },

  /** `x-paystack-signature` is the HMAC-SHA512 of the raw body, keyed with the secret key. */
  verifySignature(creds, rawBody, headers) {
    const given = header(headers, "x-paystack-signature")
    if (!given || !creds.secretKey) return false
    return safeEqual(hmacHex("sha512", creds.secretKey, rawBody), given.toLowerCase())
  },

  parseWebhook(body): ParsedWebhook {
    const b = asRecord(body)
    const type = String(b.event ?? "unknown")
    const data = asRecord(b.data)
    const metadata = asRecord(data.metadata)
    if (type === "charge.success" || type === "charge.failed") {
      const t = data as unknown as PaystackTransaction
      return { type, reference: t.reference ?? null, payment: toPayment({ ...t, status: type === "charge.success" ? "success" : "failed" }), metadata }
    }
    if (type === "refund.processed") {
      const reference = String(data.transaction_reference ?? asRecord(data.transaction).reference ?? "") || null
      return {
        type,
        reference,
        payment: reference
          ? {
              reference,
              status: "reversed",
              amount: Number(data.amount ?? 0),
              currency: asCurrency(data.currency),
              channel: null,
              fee: 0,
              paidAt: null,
              gatewayTransactionId: null,
              customer: { email: String(asRecord(data.customer).email ?? ""), name: "" },
              metadata,
            }
          : null,
        metadata,
      }
    }
    const reference = typeof data.reference === "string" ? data.reference : null
    return { type, reference, payment: null, metadata }
  },

  parseCallback(q): CallbackParams {
    return {
      reference: q.reference || q.trxref || null,
      outcome: q.outcome === "cancelled" ? "cancelled" : null,
      gatewayTransactionId: null,
    }
  },

  async testConnection(ctx, creds) {
    try {
      await gatewayRequest(ctx, "Paystack", "/balance", { secret: creds.secretKey })
      return { ok: true, message: "Paystack accepted the secret key." }
    } catch (e) {
      return { ok: false, message: (e as Error).message }
    }
  },
}
