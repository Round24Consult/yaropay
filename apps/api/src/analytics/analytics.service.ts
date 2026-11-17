import { Inject, Injectable } from "@nestjs/common"
import { bucketStart, buckets, type Kpi, type OverviewQuery, type OverviewResponse } from "@yaropay/core/analytics"
import type { GatewayId, PaymentChannel, TransactionStatus } from "@yaropay/core/types"
import { and, asc, eq, sql } from "drizzle-orm"
import { productCondition, type Scope } from "../auth/scope.js"
import { DB } from "../database/database.module.js"
import { type Db, rowsOf } from "../database/db.js"
import { products } from "../database/schema.js"

const MAX_TREND = 24

interface Totals {
  volume: number
  success: number
  failed: number
  abandoned: number
}

interface CubeRow {
  current: boolean
  day: Date
  productId: string
  gatewayId: GatewayId
  channel: PaymentChannel | null
  status: TransactionStatus
  n: number
  volume: number
}

const zero = (): Totals => ({ volume: 0, success: 0, failed: 0, abandoned: 0 })
const rate = (t: Totals) => {
  const attempts = t.success + t.failed + t.abandoned
  return attempts ? t.success / attempts : 0
}

function add(t: Totals, r: CubeRow) {
  if (r.status === "success") {
    t.volume += r.volume
    t.success += r.n
  } else if (r.status === "failed") t.failed += r.n
  else if (r.status === "abandoned") t.abandoned += r.n
}

/** Merges adjacent buckets so sparklines get at most MAX_TREND points. */
function groupTotals(rows: Totals[], max = MAX_TREND): Totals[] {
  if (rows.length <= max) return rows
  const size = rows.length / max
  const out: Totals[] = []
  for (let i = 0; i < max; i++) {
    out.push(
      rows.slice(Math.floor(i * size), Math.floor((i + 1) * size)).reduce(
        (a, r) => ({ volume: a.volume + r.volume, success: a.success + r.success, failed: a.failed + r.failed, abandoned: a.abandoned + r.abandoned }),
        zero(),
      ),
    )
  }
  return out
}

@Injectable()
export class AnalyticsService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * One grouped query (day x product x gateway x channel x status, for the
   * current and previous window) feeds every widget; the rest is arithmetic.
   */
  async overview(q: OverviewQuery, opts: { scope: Scope }): Promise<OverviewResponse> {
    const fromMs = new Date(q.from).getTime()
    const toMs = new Date(q.to).getTime()
    const prevFrom = new Date(fromMs - (toMs - fromMs + 1))
    const from = new Date(fromMs)
    const to = new Date(toMs)

    const ws = opts.scope.workspaceId
    const allowed = opts.scope.productIds
    const restricted = allowed !== "all"
    let productIds: string[]
    if (q.products.length) {
      productIds = restricted ? q.products.filter((id) => allowed.includes(id)) : q.products
    } else {
      const visible = await this.db
        .select({ id: products.id })
        .from(products)
        .where(and(eq(products.workspaceId, ws), productCondition(products.id, opts.scope)))
        .orderBy(asc(products.createdAt))
      productIds = visible.map((p) => p.id)
    }
    const filterProducts = q.products.length > 0 || restricted
    const none = filterProducts && productIds.length === 0
    const productSql = filterProducts ? sql`and product_id in (${none ? sql`null` : sql.join(productIds.map((id) => sql`${id}`), sql`, `)})` : sql``
    const gatewaySql = q.gateways.length ? sql`and gateway_id in (${sql.join(q.gateways.map((g) => sql`${g}`), sql`, `)})` : sql``

    const raw = rowsOf<{ current: boolean; day: string; product_id: string; gateway_id: string; channel: string | null; status: string; n: string; volume: string }>(
      await this.db.execute(sql`
        select created_at >= ${from} as current,
               to_char(created_at at time zone 'UTC', 'YYYY-MM-DD') as day,
               product_id, gateway_id, channel, status,
               count(*) as n, coalesce(sum(amount), 0) as volume
        from transactions
        where workspace_id = ${ws} and mode = ${q.mode} and currency = ${q.currency}
          and created_at >= ${prevFrom} and created_at <= ${to}
          ${productSql} ${gatewaySql}
        group by 1, 2, 3, 4, 5, 6`),
    )
    const cube: CubeRow[] = raw.map((r) => ({
      current: r.current,
      day: new Date(`${r.day}T00:00:00.000Z`),
      productId: r.product_id,
      gatewayId: r.gateway_id as GatewayId,
      channel: r.channel as PaymentChannel | null,
      status: r.status as TransactionStatus,
      n: Number(r.n),
      volume: Number(r.volume),
    }))
    const current = cube.filter((r) => r.current)
    const previous = cube.filter((r) => !r.current)

    const cur = zero()
    const prev = zero()
    for (const r of current) add(cur, r)
    for (const r of previous) add(prev, r)

    const bucketList = buckets(q.from, q.to, q.granularity)
    const index = new Map(bucketList.map((b, i) => [b.toISOString(), i]))
    const series = bucketList.map((b) => ({
      bucket: b.toISOString(),
      values: Object.fromEntries(productIds.map((id) => [id, 0])) as Record<string, number>,
    }))
    const perBucket = bucketList.map(zero)
    for (const r of current) {
      const i = index.get(bucketStart(r.day, q.granularity).toISOString())
      if (i === undefined) continue
      add(perBucket[i], r)
      if (r.status === "success" && r.productId in series[i].values) series[i].values[r.productId] += r.volume
    }
    const grouped = groupTotals(perBucket)
    const kpi = (c: number, p: number, trend: number[]): Kpi => ({ current: c, previous: p, trend })

    const productSlices = productIds.map((productId) => {
      const c = zero()
      const p = zero()
      for (const r of current) if (r.productId === productId) add(c, r)
      for (const r of previous) if (r.productId === productId) add(p, r)
      return { productId, volume: c.volume, previousVolume: p.volume, count: c.success, successRate: rate(c) }
    })

    const gatewayMap = new Map<GatewayId, { volume: number; count: number; byProduct: Record<string, number> }>()
    const channelMap = new Map<PaymentChannel, { volume: number; count: number }>()
    const statusMap = new Map<TransactionStatus, number>()
    for (const r of current) {
      statusMap.set(r.status, (statusMap.get(r.status) ?? 0) + r.n)
      if (r.status !== "success") continue
      const gw = gatewayMap.get(r.gatewayId) ?? { volume: 0, count: 0, byProduct: {} }
      gw.volume += r.volume
      gw.count += r.n
      gw.byProduct[r.productId] = (gw.byProduct[r.productId] ?? 0) + r.volume
      gatewayMap.set(r.gatewayId, gw)
      if (r.channel) {
        const ch = channelMap.get(r.channel) ?? { volume: 0, count: 0 }
        ch.volume += r.volume
        ch.count += r.n
        channelMap.set(r.channel, ch)
      }
    }

    const deliverySql = none
      ? sql`and false`
      : productIds.length
        ? sql`and product_id in (${sql.join(productIds.map((id) => sql`${id}`), sql`, `)})`
        : sql``
    const [health] = rowsOf<{ delivered: string; retrying: string; failed: string; p95: number | null }>(
      await this.db.execute(sql`
        select count(*) filter (where state = 'delivered') as delivered,
               count(*) filter (where state in ('retrying', 'pending')) as retrying,
               count(*) filter (where state = 'failed') as failed,
               percentile_disc(0.95) within group (order by latency_ms) filter (where state = 'delivered' and latency_ms is not null) as p95
        from webhook_deliveries
        where workspace_id = ${ws} and mode = ${q.mode} and event_type <> 'test.ping'
          and created_at >= ${from} and created_at <= ${to} ${deliverySql}`),
    )
    const [unrouted] = restricted
      ? [{ n: "0" }]
      : rowsOf<{ n: string }>(
          await this.db.execute(sql`
            select count(*) as n from webhook_events
            where workspace_id = ${ws} and product_id is null and mode = ${q.mode} and received_at >= ${from} and received_at <= ${to}`),
        )

    return {
      query: { ...q, products: q.products },
      kpis: {
        grossVolume: kpi(cur.volume, prev.volume, grouped.map((b) => b.volume)),
        successfulPayments: kpi(cur.success, prev.success, grouped.map((b) => b.success)),
        successRate: kpi(rate(cur), rate(prev), grouped.map(rate)),
        averageOrder: kpi(cur.success ? cur.volume / cur.success : 0, prev.success ? prev.volume / prev.success : 0, grouped.map((b) => (b.success ? b.volume / b.success : 0))),
      },
      series,
      products: productSlices,
      gateways: [...gatewayMap.entries()].map(([gatewayId, v]) => ({ gatewayId, ...v })).sort((a, b) => b.volume - a.volume),
      channels: [...channelMap.entries()].map(([channel, v]) => ({ channel, ...v })).sort((a, b) => b.volume - a.volume),
      statuses: [...statusMap.entries()].map(([status, count]) => ({ status, count })),
      webhooks: {
        delivered: Number(health?.delivered ?? 0),
        retrying: Number(health?.retrying ?? 0),
        failed: Number(health?.failed ?? 0),
        unrouted: Number(unrouted?.n ?? 0),
        p95LatencyMs: Number(health?.p95 ?? 0),
      },
    }
  }
}
