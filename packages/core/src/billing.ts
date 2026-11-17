import { z } from "zod"
import { FEATURES, type Feature } from "./editions.ts"
import type { CurrencyCode } from "./types.ts"

/**
 * YaroPay Cloud pricing. A workspace pays per live product each month and, if its plan says so, a
 * percentage of its live volume above a monthly threshold. The super admin sets every number (plans,
 * prices, exchange rates); nothing here is a fixed price. The same functions run in the API (invoices)
 * and the dashboard (previews), so both always agree.
 *
 * Money is in minor units (kobo, cents). Every supported currency has two minor digits.
 */

export const BILLING_CURRENCIES = ["NGN", "USD"] as const
export type BillingCurrency = (typeof BILLING_CURRENCIES)[number]

export interface VolumeFee {
  enabled: boolean
  /** Percentage of the volume above the threshold, in basis points (150 = 1.5%). */
  rateBps: number
  /** Monthly live volume that is free, per billing currency. */
  threshold: Record<BillingCurrency, number>
  /** Most the volume fee can be in a month, per billing currency. Null: no cap. */
  cap: Record<BillingCurrency, number> | null
}

export interface PriceSchedule {
  /** Monthly price of each live product, per billing currency. */
  perLiveProduct: Record<BillingCurrency, number>
  volumeFee: VolumeFee
}

/**
 * Naira per one unit of each other currency, as decimal strings ("1550.25"). The super admin keeps
 * these current; volume in a currency without a rate is left out of the fee and flagged.
 */
export type ExchangeRates = Partial<Record<CurrencyCode, string>>

/**
 * A price change applies from the start of a month: "next_month" by default, or "this_month" (the month
 * not invoiced yet) when the super admin chooses.
 */
export type PriceEffective = "this_month" | "next_month"

export interface PriceVersion {
  id: string
  /** First moment this price applies (the start of a UTC month, or the beginning of time). */
  effectiveFrom: string
  schedule: PriceSchedule
}

export interface BillingPlan {
  id: string
  slug: string
  name: string
  description: string
  /** Offered at sign-up and on the pricing page. Private plans are for custom deals. */
  public: boolean
  /** Days of free live use after a workspace's first live payment. */
  trialDays: number
  features: Feature[]
  active: boolean
  /** The price this month. */
  price: PriceVersion
  /** A price already scheduled for a later month, if any. */
  nextPrice: PriceVersion | null
  workspaces: number
}

/** What the public pricing endpoint shows: a public plan without its internal counts. */
export type PublicPlan = Pick<BillingPlan, "slug" | "name" | "description" | "trialDays" | "features" | "price" | "nextPrice">

export interface UsageLine {
  currency: CurrencyCode
  /** Successful live payments, in minor units of `currency`. */
  amount: number
  count: number
}

export interface Usage {
  /** Non-sample products with at least one live payment in the period. */
  liveProducts: { id: string; name: string }[]
  volume: UsageLine[]
}

export interface ChargeLine {
  kind: "live_product" | "volume_fee"
  description: string
  quantity: number
  /** Minor units of the billing currency. */
  unitAmount: number
  amount: number
}

export interface PricedUsage {
  currency: BillingCurrency
  lines: ChargeLine[]
  total: number
  /** Live volume in the billing currency (only currencies with a rate). */
  volume: number
  /** Currencies with live volume but no exchange rate: not counted, and the super admin is told. */
  unconverted: CurrencyCode[]
}

/** The start of the UTC month that `at` falls in. */
export function monthStart(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1))
}

export function addMonths(at: Date, months: number): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + months, 1))
}

/** "2026-11" for the month starting at `start`. */
export function periodKey(start: Date): string {
  return `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, "0")}`
}

/**
 * Converts minor units between currencies with naira as the common unit. Null when a rate is missing.
 * Rounded to the nearest minor unit.
 */
export function convertMinor(amount: number, from: CurrencyCode, to: CurrencyCode, rates: ExchangeRates): number | null {
  if (from === to) return amount
  const nairaPer = (c: CurrencyCode): number | null => {
    if (c === "NGN") return 1
    const r = rates[c]
    const n = r === undefined ? NaN : Number(r)
    return Number.isFinite(n) && n > 0 ? n : null
  }
  const a = nairaPer(from)
  const b = nairaPer(to)
  if (a === null || b === null) return null
  return Math.round((amount * a) / b)
}

/** The fee on `volume` (billing currency, minor units): only the part above the threshold, capped. */
export function volumeFeeFor(fee: VolumeFee, currency: BillingCurrency, volume: number): number {
  if (!fee.enabled || fee.rateBps <= 0) return 0
  const above = Math.max(0, volume - fee.threshold[currency])
  const amount = Math.round((above * fee.rateBps) / 10_000)
  return fee.cap ? Math.min(amount, fee.cap[currency]) : amount
}

/** What a month of usage costs on a price schedule. */
export function priceUsage(schedule: PriceSchedule, currency: BillingCurrency, usage: Usage, rates: ExchangeRates): PricedUsage {
  const lines: ChargeLine[] = []
  const unit = schedule.perLiveProduct[currency]
  // A plan that charges nothing per product (volume only) doesn't list them as zero lines.
  if (unit > 0) {
    for (const p of [...usage.liveProducts].sort((a, b) => a.name.localeCompare(b.name))) {
      lines.push({ kind: "live_product", description: `Live product: ${p.name}`, quantity: 1, unitAmount: unit, amount: unit })
    }
  }
  let volume = 0
  const unconverted: CurrencyCode[] = []
  for (const v of usage.volume) {
    const converted = convertMinor(v.amount, v.currency, currency, rates)
    if (converted === null) unconverted.push(v.currency)
    else volume += converted
  }
  const fee = volumeFeeFor(schedule.volumeFee, currency, volume)
  if (fee > 0) {
    const pct = (schedule.volumeFee.rateBps / 100).toLocaleString("en", { maximumFractionDigits: 2 })
    lines.push({ kind: "volume_fee", description: `${pct}% of live volume above the monthly threshold`, quantity: 1, unitAmount: fee, amount: fee })
  }
  return { currency, lines, total: lines.reduce((s, l) => s + l.amount, 0), volume, unconverted }
}

/** The version that applies to the month starting at `periodStart`: the latest one already in effect. */
export function priceFor<T extends { effectiveFrom: string | Date; createdAt?: string | Date }>(versions: T[], periodStart: Date): T | null {
  const t = periodStart.getTime()
  let best: T | null = null
  for (const v of versions) {
    const from = new Date(v.effectiveFrom).getTime()
    if (from > t) continue
    if (
      !best ||
      from > new Date(best.effectiveFrom).getTime() ||
      (from === new Date(best.effectiveFrom).getTime() && new Date(v.createdAt ?? 0).getTime() > new Date(best.createdAt ?? 0).getTime())
    ) {
      best = v
    }
  }
  return best
}

// ---- Input schemas (super admin) ----

const MAX_MINOR = 100_000_000_000 // a billion in major units
const minor = z.number().int("Use whole minor units").min(0, "Can't be negative").max(MAX_MINOR)
const perCurrency = z.object({ NGN: minor, USD: minor })

export const priceScheduleSchema = z.object({
  perLiveProduct: perCurrency,
  volumeFee: z.object({
    enabled: z.boolean(),
    rateBps: z.number().int().min(0).max(10_000, "At most 100%"),
    threshold: perCurrency,
    cap: perCurrency.nullable(),
  }),
})

export const newPriceSchema = z.object({
  schedule: priceScheduleSchema,
  effective: z.enum(["this_month", "next_month"]).default("next_month"),
})

const feature = z.enum(FEATURES)

export const createPlanSchema = z.object({
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{1,30}$/, "Lowercase letters, numbers and dashes"),
  name: z.string().trim().min(2).max(40),
  description: z.string().trim().max(200).default(""),
  public: z.boolean().default(false),
  trialDays: z.number().int().min(0).max(365).default(14),
  features: z.array(feature).max(FEATURES.length).default([]),
  schedule: priceScheduleSchema,
})

export const updatePlanSchema = z
  .object({
    name: z.string().trim().min(2).max(40).optional(),
    description: z.string().trim().max(200).optional(),
    public: z.boolean().optional(),
    trialDays: z.number().int().min(0).max(365).optional(),
    features: z.array(feature).max(FEATURES.length).optional(),
    active: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Nothing to update")

/** Naira per unit, e.g. "1550.25". Up to 6 decimal places. */
const rate = z
  .string()
  .trim()
  .regex(/^\d{1,9}(\.\d{1,6})?$/, "Enter a number like 1550.25")
  .refine((v) => Number(v) > 0, "Must be more than zero")

export const exchangeRatesSchema = z.object({
  rates: z.object({ USD: rate.optional(), GHS: rate.optional(), KES: rate.optional(), ZAR: rate.optional() }),
})

export type CreatePlanInput = z.infer<typeof createPlanSchema>
export type UpdatePlanInput = z.infer<typeof updatePlanSchema>
export type NewPriceInput = z.infer<typeof newPriceSchema>

// ---- Invoices ----

/** Days a company has to pay an invoice. */
export const INVOICE_DUE_DAYS = 7

export type InvoiceStatus = "open" | "paid" | "void"

export interface Invoice {
  id: string
  number: string
  /** "2026-11" */
  period: string
  periodStart: string
  periodEnd: string
  currency: BillingCurrency
  planName: string
  lines: ChargeLine[]
  total: number
  status: InvoiceStatus
  issuedAt: string
  dueAt: string
  paidAt: string | null
  paidVia: "card" | "manual" | null
  note: string | null
  /** Automatic charges to the saved card so far, and why the last one failed. */
  attempts: number
  lastError: string | null
}

/** `past_due`: an invoice is unpaid after its due date. Paid features pause and new products can't go live. */
export type BillingStatus = "ok" | "past_due"

/** A company's saved card, as far as anyone can see it. */
export interface SavedCard {
  brand: string
  last4: string
  expMonth: string
  expYear: string
  bank: string
  currency: BillingCurrency
  addedAt: string
}

/** Saving a card charges this much and refunds it straight away. */
export const CARD_CHECK_AMOUNT: Record<BillingCurrency, number> = { NGN: 5_000, USD: 100 }

/** Automatic charges per invoice: on the day it's issued, then every two days. */
export const MAX_CHARGE_ATTEMPTS = 4
export const CHARGE_RETRY_HOURS = 48

/** Where to send the browser to pay (Paystack checkout). */
export interface Checkout {
  authorizationUrl: string
  reference: string
}

/** What a finished checkout did. */
export interface CheckoutResult {
  status: "success" | "failed" | "pending"
  purpose: "invoice_checkout" | "card_check"
  message: string | null
}

export const confirmCheckoutSchema = z.object({ reference: z.string().trim().min(8).max(100) })

/** A company's Billing tab (Cloud). */
export interface BillingSummary {
  plan: { slug: string; name: string; price: PriceVersion; nextPrice: PriceVersion | null } | null
  billingCurrency: BillingCurrency
  trialEndsAt: string | null
  /** Trial days that start with the first live payment (until then, only test mode has been used). */
  pendingTrialDays: number | null
  freeUntil: string | null
  /** This month so far: what was used, and what it costs (after trial and free months). */
  thisMonth: { usage: Usage; priced: PricedUsage | null }
  invoices: Invoice[]
  billingStatus: BillingStatus
  pastDueSince: string | null
  card: SavedCard | null
  /** Whether YaroPay can take card payments yet (its own Paystack account is set up). */
  cardPayments: boolean
}

/** The super admin's invoice list: an invoice plus whose it is. */
export interface PlatformInvoice extends Invoice {
  workspaceId: string
  workspaceName: string
}

export const markInvoicePaidSchema = z.object({ note: z.string().trim().max(200).optional() })
export const voidInvoiceSchema = z.object({ reason: z.string().trim().min(3, "Say why, for the record").max(200) })

/** "November 2026" for "2026-11". */
export function periodLabel(period: string): string {
  const [y, m] = period.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en", { month: "long", year: "numeric", timeZone: "UTC" })
}
