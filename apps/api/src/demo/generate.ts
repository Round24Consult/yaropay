import type { ProductEvent } from "@yaropay/core/payments"
import { makeReference, PRODUCT_METADATA_KEY } from "@yaropay/core/routing"
import type { CurrencyCode, GatewayId, Mode, PaymentChannel, TransactionStatus } from "@yaropay/core/types"
import type { TimelineStepJson } from "../database/schema.js"
import { amountAround, between, mulberry32, pick, poisson, randomId, type Rng, weighted } from "./random.js"

/**
 * Deterministic demo data: Company A with three products sharing one
 * Paystack and one Flutterwave account, about 13 months of payments, the
 * matching gateway events and product deliveries, and a few unrouted events.
 */

const DAY = 86_400_000
const iso = (ms: number) => new Date(ms).toISOString()

export interface DemoConnection {
  id: string
  gatewayId: GatewayId
  label: string
  mode: Mode
  credentials: Record<string, string>
  createdAt: Date
}

export interface DemoProduct {
  id: string
  name: string
  slug: string
  kind: "website" | "saas" | "mobile" | "other"
  websiteUrl: string
  colorSlot: number
  referencePrefix: string
  webhookUrl: string
  successUrl: string
  failureUrl: string
  cancelUrl: string | null
  createdAt: Date
  gateways: { connectionId: string; isDefault: boolean }[]
}

export interface DemoTransaction {
  id: string
  reference: string
  productId: string
  connectionId: string
  gatewayId: GatewayId
  mode: Mode
  amount: number
  fee: number
  currency: CurrencyCode
  status: TransactionStatus
  channel: PaymentChannel | null
  customerEmail: string
  customerName: string
  metadata: Record<string, unknown>
  gatewayTransactionId: string | null
  timeline: TimelineStepJson[]
  createdAt: Date
  paidAt: Date | null
}

export interface DemoEvent {
  id: string
  gatewayId: GatewayId
  connectionId: string
  mode: Mode
  type: string
  reference: string | null
  signatureValid: boolean
  productId: string | null
  matchedBy: string | null
  dedupeKey: string
  payload: Record<string, unknown>
  receivedAt: Date
}

export interface DemoDelivery {
  id: string
  eventId: string
  transactionId: string
  productId: string
  mode: Mode
  url: string
  eventType: string
  payload: Record<string, unknown>
  state: "delivered" | "retrying" | "failed"
  statusCode: number | null
  attempts: number
  nextRetryAt: Date | null
  latencyMs: number | null
  responseSnippet: string
  createdAt: Date
  lastAttemptAt: Date
}

const FIRST = ["Adaeze", "Tunde", "Chioma", "Emeka", "Kemi", "Ifeanyi", "Ngozi", "Seun", "Amara", "Bola", "Kwame", "Ama", "Wanjiru", "Otieno", "Zainab", "Musa", "Halima", "Femi", "Yemi", "Uche", "Akosua", "Kofi", "Thandi", "Sipho", "Efe", "Osas", "Nneka", "Dayo", "Lola", "Ike"]
const LAST = ["Okafor", "Adeyemi", "Balogun", "Eze", "Mensah", "Okoro", "Ibrahim", "Bello", "Nwosu", "Owusu", "Kamau", "Odhiambo", "Danjuma", "Afolabi", "Chukwu", "Asante", "Ndlovu", "Obi", "Lawal", "Abubakar"]
const DOMAINS = ["example.com", "example.net", "example.org"]

function makeCustomer(rng: Rng) {
  const first = pick(rng, FIRST)
  const last = pick(rng, LAST)
  const n = Math.floor(rng() * 90) + 10
  return { name: `${first} ${last}`, email: `${first}.${last}${n}`.toLowerCase() + `@${pick(rng, DOMAINS)}` }
}

const CHANNELS: Record<"paystack" | "flutterwave", readonly (readonly [PaymentChannel, number])[]> = {
  paystack: [["card", 58], ["bank_transfer", 21], ["ussd", 8], ["bank", 7], ["mobile_money", 4], ["qr", 2]],
  flutterwave: [["card", 52], ["mobile_money", 27], ["bank_transfer", 16], ["ussd", 5]],
}

function fee(gatewayId: GatewayId, amount: number, currency: CurrencyCode) {
  if (gatewayId === "paystack" && currency === "NGN") return Math.min(Math.round(amount * 0.015) + (amount >= 250_000 ? 10_000 : 0), 200_000)
  if (gatewayId === "paystack") return Math.round(amount * 0.039)
  return Math.round(amount * (currency === "NGN" ? 0.014 : 0.038))
}

interface Profile {
  daily: number
  growth: number
  amount: (rng: Rng) => { amount: number; currency: CurrencyCode }
}

const PROFILES: Record<string, Profile> = {
  prd_shopwise: { daily: 7, growth: 0.9, amount: (rng) => ({ amount: amountAround(rng, 2_400_000, 0.75, 5_000), currency: "NGN" }) },
  prd_ledgerpro: {
    daily: 3.2,
    growth: 1.4,
    amount: (rng) =>
      weighted(rng, [
        [{ amount: 1_500_000, currency: "NGN" as CurrencyCode }, 40],
        [{ amount: 4_500_000, currency: "NGN" as CurrencyCode }, 28],
        [{ amount: 12_000_000, currency: "NGN" as CurrencyCode }, 9],
        [{ amount: 2_900, currency: "USD" as CurrencyCode }, 14],
        [{ amount: 9_900, currency: "USD" as CurrencyCode }, 9],
      ]),
  },
  prd_ridenow: {
    daily: 9,
    growth: 0.6,
    amount: (rng) =>
      weighted(rng, [
        [{ amount: amountAround(rng, 420_000, 0.5, 5_000), currency: "NGN" as CurrencyCode }, 78],
        [{ amount: amountAround(rng, 6_500, 0.45, 50), currency: "GHS" as CurrencyCode }, 12],
        [{ amount: amountAround(rng, 85_000, 0.45, 500), currency: "KES" as CurrencyCode }, 10],
      ]),
  },
}

function buildPayment(rng: Rng, product: DemoProduct, connection: DemoConnection, createdMs: number, nowMs: number) {
  const gatewayId = connection.gatewayId as "paystack" | "flutterwave"
  const gatewayName = gatewayId === "paystack" ? "Paystack" : "Flutterwave"
  const { amount, currency } = PROFILES[product.id].amount(rng)
  let status: TransactionStatus = weighted(rng, [["success", 88], ["failed", 6], ["abandoned", 5], ["reversed", 0.6]])
  if (nowMs - createdMs < 20 * 60_000 && rng() < 0.25) status = "pending"
  const channel = status === "pending" || status === "abandoned" ? null : weighted(rng, CHANNELS[gatewayId])
  const reference = makeReference(product.referencePrefix, rng)
  const customer = makeCustomer(rng)
  const id = randomId(rng, "txn", 12)
  const tRedirect = createdMs + 900 + Math.floor(rng() * 1500)
  const tPay = tRedirect + Math.floor(between(rng, 25, 240) * 1000)
  const timeline: TimelineStepJson[] = [
    { kind: "initialized", at: iso(createdMs), title: `Initialised by ${product.name}`, detail: `POST /v1/products/${product.id}/payments with reference ${reference}`, ok: true },
    { kind: "redirected", at: iso(tRedirect), title: `Checkout created on ${gatewayName}`, detail: `${gatewayId === "paystack" ? "callback_url" : "redirect_url"} set to the ${product.name} callback`, ok: true },
  ]
  let event: DemoEvent | null = null
  let delivery: DemoDelivery | null = null
  let paidAt: Date | null = null
  const gatewayTransactionId = String(Math.floor(between(rng, 1e9, 9e9)))

  if (status === "abandoned") {
    timeline.push({ kind: "failed", at: iso(tRedirect + 30 * 60_000), title: "Checkout abandoned", detail: "The customer closed the checkout. No webhook was sent.", ok: false })
  } else if (status !== "pending") {
    const ok = status === "success" || status === "reversed"
    timeline.push({
      kind: "callback",
      at: iso(tPay),
      title: `${gatewayName} returned the customer`,
      detail: `GET /v1/callback/${product.id}/${gatewayId}?reference=${reference}`,
      ok,
    })
    timeline.push({
      kind: "verified",
      at: iso(tPay + 400),
      title: ok ? "Payment verified with the gateway" : "Gateway reported the payment as failed",
      detail: `Customer sent to the ${product.name} ${ok ? "success" : "failure"} URL`,
      ok,
    })
    if (ok) {
      paidAt = new Date(tPay)
      const tHook = tPay + 1500 + Math.floor(rng() * 4000)
      const type = gatewayId === "paystack" ? "charge.success" : "charge.completed"
      event = {
        id: randomId(rng, "evt", 12),
        gatewayId,
        connectionId: connection.id,
        mode: connection.mode,
        type,
        reference,
        signatureValid: true,
        productId: product.id,
        matchedBy: "metadata",
        dedupeKey: randomId(rng, "demo", 24),
        receivedAt: new Date(tHook),
        payload: {
          event: type,
          data: {
            id: Number(gatewayTransactionId),
            ...(gatewayId === "paystack" ? { reference, amount, status: "success" } : { tx_ref: reference, amount: amount / 100, status: "successful" }),
            currency,
            channel,
            customer: { email: customer.email },
            metadata: { [PRODUCT_METADATA_KEY]: product.id },
          },
        },
      }
      timeline.push({ kind: "webhook_received", at: iso(tHook), title: `${type} webhook received`, detail: `${gatewayId === "paystack" ? "x-paystack-signature" : "verif-hash"} checked`, ok: true })
      timeline.push({ kind: "routed", at: iso(tHook + 3), title: `Matched to ${product.name}`, detail: `metadata.${PRODUCT_METADATA_KEY} = ${product.id}`, ok: true })
      const recent = nowMs - tHook < 2 * DAY
      const state = recent ? weighted(rng, [["delivered", 90], ["retrying", 7], ["failed", 3]] as const) : weighted(rng, [["delivered", 98.5], ["failed", 1.5]] as const)
      const latency = Math.round(amountAround(rng, 160, 0.5, 1))
      const attempts = state === "delivered" ? (rng() < 0.04 ? 2 : 1) : state === "retrying" ? 1 + Math.floor(rng() * 3) : 8
      const statusCode = state === "delivered" ? 200 : pick(rng, [500, 502, 503, 504, 404] as const)
      const lastAttempt = tHook + 5 + (attempts - 1) * 60_000
      const productEvent: ProductEvent = {
        id: randomId(rng, "pev", 12),
        type: "payment.succeeded",
        mode: connection.mode,
        createdAt: iso(tHook + 4),
        data: {
          id,
          reference,
          productId: product.id,
          gateway: gatewayId,
          amount,
          fee: fee(gatewayId, amount, currency),
          currency,
          status: "success",
          channel,
          customer,
          metadata: { [PRODUCT_METADATA_KEY]: product.id },
          paidAt: iso(tPay),
        },
      }
      delivery = {
        id: randomId(rng, "dlv", 12),
        eventId: event.id,
        transactionId: id,
        productId: product.id,
        mode: connection.mode,
        url: product.webhookUrl,
        eventType: "payment.succeeded",
        payload: productEvent as unknown as Record<string, unknown>,
        state,
        statusCode: state === "retrying" && rng() < 0.3 ? null : statusCode,
        attempts,
        nextRetryAt: state === "retrying" ? new Date(nowMs + Math.floor(between(rng, 20, 90)) * 60_000) : null,
        latencyMs: state === "delivered" ? latency : null,
        responseSnippet: state === "delivered" ? '{"received":true}' : statusCode === 404 ? "<html><body>Not Found</body></html>" : "upstream connect error or disconnect/reset before headers",
        createdAt: new Date(tHook + 5),
        lastAttemptAt: new Date(lastAttempt),
      }
      timeline.push({
        kind: "forwarded",
        at: iso(lastAttempt),
        title: state === "delivered" ? `Forwarded to ${product.name}` : state === "retrying" ? `Delivery to ${product.name} is retrying` : `Delivery to ${product.name} failed`,
        detail: state === "delivered" ? `200 in ${latency} ms, signed with x-yaropay-signature` : `${delivery.statusCode ?? "No response"} on attempt ${attempts}`,
        ok: state === "delivered",
      })
    }
  }

  const tx: DemoTransaction = {
    id,
    reference,
    productId: product.id,
    connectionId: connection.id,
    gatewayId,
    mode: connection.mode,
    amount,
    fee: status === "success" || status === "reversed" ? fee(gatewayId, amount, currency) : 0,
    currency,
    status,
    channel,
    customerEmail: customer.email,
    customerName: customer.name,
    metadata: { [PRODUCT_METADATA_KEY]: product.id, orderId: String(Math.floor(rng() * 90_000) + 10_000) },
    gatewayTransactionId: status === "pending" || status === "abandoned" ? null : gatewayTransactionId,
    timeline,
    createdAt: new Date(createdMs),
    paidAt,
  }
  return { tx, event, delivery }
}

/** `ownerName`: who the sample audit log says made the owner's changes (the signed-in owner, ideally). */
export function generateDemo(nowMs = Date.now(), opts: { webhookBase?: string; ownerName?: string } = {}) {
  const ownerName = opts.ownerName ?? "Ada Okafor"
  const rng = mulberry32(20261115)
  const yearAgo = nowMs - 395 * DAY
  const hook = (product: string, path: string) => (opts.webhookBase ? `${opts.webhookBase.replace(/\/+$/, "")}/${product}` : path)

  const connections: DemoConnection[] = [
    {
      id: "con_ps_main",
      gatewayId: "paystack",
      label: "Main account",
      mode: "live",
      credentials: { publicKey: "pk_live_demo4f9c2a7e1b6d8f30a5c9", secretKey: "sk_live_demo8d1e6c3b9a2f7e4d0c5b8a1f" },
      createdAt: new Date(yearAgo),
    },
    {
      id: "con_fw_main",
      gatewayId: "flutterwave",
      label: "Main account",
      mode: "live",
      credentials: {
        publicKey: "FLWPUBK-demo7a2c9e4f1b8d3a6c5e0f-X",
        secretKey: "FLWSECK-demo3e8b1d6f9a2c7e4b0d5f-X",
        encryptionKey: "demo5d2a9f7c1e3b",
        secretHash: "demo-hash-9c4e2a7f1b8d3e6c",
      },
      createdAt: new Date(yearAgo + 40 * DAY),
    },
    {
      id: "con_ps_test",
      gatewayId: "paystack",
      label: "Sandbox",
      mode: "test",
      credentials: { publicKey: "pk_test_demo2b7e9c4a1f6d8e30b5a9", secretKey: "sk_test_demo6a1d9e3c7b2f8e4a0d5c9b1e" },
      createdAt: new Date(yearAgo),
    },
  ]

  const products: DemoProduct[] = [
    {
      id: "prd_shopwise",
      name: "Shopwise",
      slug: "shopwise",
      kind: "website",
      websiteUrl: "https://shopwise.example.com",
      colorSlot: 1,
      referencePrefix: "SHW",
      webhookUrl: hook("shopwise", "https://shopwise.example.com/api/payments/webhook"),
      successUrl: "https://shopwise.example.com/checkout/success",
      failureUrl: "https://shopwise.example.com/checkout/failed",
      cancelUrl: "https://shopwise.example.com/cart",
      createdAt: new Date(yearAgo),
      gateways: [
        { connectionId: "con_ps_main", isDefault: true },
        { connectionId: "con_fw_main", isDefault: false },
        { connectionId: "con_ps_test", isDefault: false },
      ],
    },
    {
      id: "prd_ledgerpro",
      name: "LedgerPro",
      slug: "ledgerpro",
      kind: "saas",
      websiteUrl: "https://app.ledgerpro.example.com",
      colorSlot: 2,
      referencePrefix: "LDG",
      webhookUrl: hook("ledgerpro", "https://api.ledgerpro.example.com/billing/webhooks/yaropay"),
      successUrl: "https://app.ledgerpro.example.com/billing?status=paid",
      failureUrl: "https://app.ledgerpro.example.com/billing?status=failed",
      cancelUrl: null,
      createdAt: new Date(yearAgo + 30 * DAY),
      gateways: [
        { connectionId: "con_ps_main", isDefault: true },
        { connectionId: "con_ps_test", isDefault: false },
      ],
    },
    {
      id: "prd_ridenow",
      name: "RideNow",
      slug: "ridenow",
      kind: "mobile",
      websiteUrl: "https://ridenow.example.com",
      colorSlot: 3,
      referencePrefix: "RDN",
      webhookUrl: hook("ridenow", "https://api.ridenow.example.com/v2/payments/events"),
      successUrl: "ridenow://payment/success",
      failureUrl: "ridenow://payment/failed",
      cancelUrl: "ridenow://payment/cancelled",
      createdAt: new Date(yearAgo + 60 * DAY),
      gateways: [
        { connectionId: "con_fw_main", isDefault: true },
        { connectionId: "con_ps_main", isDefault: false },
        { connectionId: "con_ps_test", isDefault: false },
      ],
    },
  ]

  const transactions: DemoTransaction[] = []
  const events: DemoEvent[] = []
  const deliveries: DemoDelivery[] = []
  const byId = new Map(connections.map((c) => [c.id, c]))

  for (const product of products) {
    const profile = PROFILES[product.id]
    const live = product.gateways.map((g) => byId.get(g.connectionId)!).filter((c) => c.mode === "live")
    const test = product.gateways.map((g) => byId.get(g.connectionId)!).filter((c) => c.mode === "test")
    const defaultLive = live.find((c) => product.gateways.find((g) => g.connectionId === c.id)?.isDefault) ?? live[0]
    for (let day = product.createdAt.getTime(); day < nowMs; day += DAY) {
      const progress = (day - yearAgo) / (nowMs - yearAgo)
      const dow = new Date(day).getUTCDay()
      const weekly = dow === 5 || dow === 6 ? 1.25 : dow === 0 ? 0.8 : 1
      const december = new Date(day).getUTCMonth() === 11 ? 1.35 : 1
      const n = poisson(rng, profile.daily * (0.55 + profile.growth * progress) * weekly * december)
      for (let i = 0; i < n; i++) {
        const at = day + Math.floor(rng() * DAY)
        if (at > nowMs) continue
        const conn = live.length > 1 && rng() < 0.22 ? pick(rng, live.filter((c) => c !== defaultLive)) : defaultLive
        const r = buildPayment(rng, product, conn, at, nowMs)
        transactions.push(r.tx)
        if (r.event) events.push(r.event)
        if (r.delivery) deliveries.push(r.delivery)
      }
      if (test.length && nowMs - day < 30 * DAY && rng() < 0.6) {
        const at = day + Math.floor(rng() * DAY)
        if (at <= nowMs) {
          const r = buildPayment(rng, product, test[0], at, nowMs)
          transactions.push(r.tx)
          if (r.event) events.push(r.event)
          if (r.delivery) deliveries.push(r.delivery)
        }
      }
    }
  }

  // Events that matched no product: payments made on a gateway payment page.
  for (let i = 0; i < 14; i++) {
    const at = nowMs - Math.floor(rng() * 75 * DAY)
    const conn = rng() < 0.7 ? connections[0] : connections[1]
    const ref = conn.gatewayId === "paystack" ? `T${Math.floor(between(rng, 1e9, 9e9))}` : `FLW-PAGE-${Math.floor(between(rng, 1e5, 9e5))}`
    const type = conn.gatewayId === "paystack" ? pick(rng, ["charge.success", "charge.success", "refund.processed"]) : "charge.completed"
    events.push({
      id: randomId(rng, "evt", 12),
      gatewayId: conn.gatewayId,
      connectionId: conn.id,
      mode: conn.mode,
      type,
      reference: ref,
      signatureValid: true,
      productId: null,
      matchedBy: null,
      dedupeKey: randomId(rng, "demo", 24),
      receivedAt: new Date(at),
      payload: { event: type, data: { reference: ref, amount: amountAround(rng, 1_800_000, 0.6, 5_000), currency: "NGN", metadata: {} } },
    })
  }

  const lastEvent = new Map<string, Date>()
  for (const e of events) {
    const prev = lastEvent.get(e.connectionId)
    if (!prev || e.receivedAt > prev) lastEvent.set(e.connectionId, e.receivedAt)
  }

  const audit = [
    { actorName: "Tunde Bello", action: "Rotated live API key", target: "LedgerPro", at: new Date(nowMs - 2 * 3_600_000) },
    { actorName: ownerName, action: "Replayed delivery", target: "payment.succeeded to Shopwise: delivered", at: new Date(nowMs - 9 * 3_600_000) },
    { actorName: "Wanjiru Kamau", action: "Updated product", target: "RideNow", at: new Date(nowMs - 2 * DAY) },
    { actorName: ownerName, action: "Installed app", target: "Flutterwave, Main account (live)", at: new Date(yearAgo + 40 * DAY) },
    { actorName: ownerName, action: "Created product", target: "RideNow", at: new Date(yearAgo + 60 * DAY) },
  ]

  return { connections, products, transactions, events, deliveries, lastEvent, audit }
}
