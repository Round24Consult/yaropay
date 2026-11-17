import type { CurrencyCode, GatewayId, Mode, PaymentChannel, TransactionStatus } from "./types.ts"

/** API contract for analytics. The NestJS backend must return the same shapes. */
export type Granularity = "day" | "week" | "month"

export type PeriodPreset = "today" | "7d" | "30d" | "90d" | "ytd" | "12m" | "custom"

export interface OverviewQuery {
  from: string
  to: string
  products: string[]
  gateways: GatewayId[]
  currency: CurrencyCode
  granularity: Granularity
  mode: Mode
}

export interface Kpi {
  current: number
  previous: number
  /** Up to 24 points for the sparkline, oldest first. */
  trend: number[]
}

export interface ProductSlice {
  productId: string
  volume: number
  previousVolume: number
  count: number
  successRate: number
}

export interface SeriesPoint {
  /** ISO date of the bucket start. */
  bucket: string
  /** Successful volume per product id, minor units. */
  values: Record<string, number>
}

export interface OverviewResponse {
  query: OverviewQuery
  kpis: {
    grossVolume: Kpi
    successfulPayments: Kpi
    successRate: Kpi
    averageOrder: Kpi
  }
  series: SeriesPoint[]
  products: ProductSlice[]
  /** Volume per gateway, with the share each product contributed through it. */
  gateways: { gatewayId: GatewayId; volume: number; count: number; byProduct: Record<string, number> }[]
  channels: { channel: PaymentChannel; volume: number; count: number }[]
  statuses: { status: TransactionStatus; count: number }[]
  webhooks: {
    delivered: number
    retrying: number
    failed: number
    unrouted: number
    p95LatencyMs: number
  }
}

export const PERIOD_PRESETS: { value: Exclude<PeriodPreset, "custom">; label: string; short: string }[] = [
  { value: "today", label: "Today", short: "1D" },
  { value: "7d", label: "Last 7 days", short: "7D" },
  { value: "30d", label: "Last 30 days", short: "30D" },
  { value: "90d", label: "Last 90 days", short: "90D" },
  { value: "ytd", label: "Year to date", short: "YTD" },
  { value: "12m", label: "Last 12 months", short: "12M" },
]

const DAY = 86_400_000

function startOfDay(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

/** Resolves a preset to an inclusive [from, to] range in UTC. */
export function resolvePeriod(preset: PeriodPreset, now = new Date(), custom?: { from?: string; to?: string }) {
  const end = new Date(startOfDay(now).getTime() + DAY - 1)
  let start: Date
  switch (preset) {
    case "today":
      start = startOfDay(now)
      break
    case "7d":
      start = new Date(startOfDay(now).getTime() - 6 * DAY)
      break
    case "30d":
      start = new Date(startOfDay(now).getTime() - 29 * DAY)
      break
    case "90d":
      start = new Date(startOfDay(now).getTime() - 89 * DAY)
      break
    case "ytd":
      start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1))
      break
    case "12m":
      // 12 whole calendar months, the current one included, so monthly charts get 12 bars.
      start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1))
      break
    case "custom": {
      const f = custom?.from ? new Date(custom.from) : new Date(startOfDay(now).getTime() - 29 * DAY)
      const t = custom?.to ? new Date(custom.to) : end
      return { from: startOfDay(f).toISOString(), to: new Date(startOfDay(t).getTime() + DAY - 1).toISOString() }
    }
  }
  return { from: start.toISOString(), to: end.toISOString() }
}

/** Picks a sensible default bucket size for a range. */
export function defaultGranularity(fromIso: string, toIso: string): Granularity {
  const days = (new Date(toIso).getTime() - new Date(fromIso).getTime()) / DAY
  if (days <= 45) return "day"
  if (days <= 200) return "week"
  return "month"
}

/** Start of the bucket containing `date` (UTC; weeks start Monday). */
export function bucketStart(date: Date, g: Granularity): Date {
  const d = startOfDay(date)
  if (g === "day") return d
  if (g === "week") {
    const dow = (d.getUTCDay() + 6) % 7
    return new Date(d.getTime() - dow * DAY)
  }
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
}

export function nextBucket(date: Date, g: Granularity): Date {
  if (g === "day") return new Date(date.getTime() + DAY)
  if (g === "week") return new Date(date.getTime() + 7 * DAY)
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1))
}

/** All bucket starts covering [from, to]. */
export function buckets(fromIso: string, toIso: string, g: Granularity): Date[] {
  const out: Date[] = []
  const end = new Date(toIso)
  for (let b = bucketStart(new Date(fromIso), g); b <= end; b = nextBucket(b, g)) out.push(b)
  return out
}
