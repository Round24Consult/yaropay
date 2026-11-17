import { Inject, Injectable } from "@nestjs/common"
import { type PeriodPreset, resolvePeriod } from "@yaropay/core/analytics"
import type { TransactionDetail, TransactionList, TransactionRow } from "@yaropay/core/api"
import type { CurrencyCode, GatewayId, Mode, PaymentChannel, TimelineStep, Transaction, TransactionStatus } from "@yaropay/core/types"
import { and, asc, count, desc, eq, gte, ilike, inArray, isNotNull, lte, or, type SQL, sql } from "drizzle-orm"
import type { PgColumn } from "drizzle-orm/pg-core"
import { pageMeta } from "../common/query.js"
import { productCondition, type Scope } from "../auth/scope.js"
import { DB } from "../database/database.module.js"
import type { Db } from "../database/db.js"
import { products, transactions, type TransactionRowDb, webhookDeliveries, webhookEvents } from "../database/schema.js"
import { toDeliveryDto } from "../webhooks/deliveries.service.js"
import { toEventDto } from "../webhooks/events.service.js"

export function toTransactionRow(r: TransactionRowDb): TransactionRow {
  return {
    id: r.id,
    reference: r.reference,
    productId: r.productId,
    connectionId: r.connectionId,
    gatewayId: r.gatewayId as GatewayId,
    mode: r.mode as Mode,
    amount: r.amount,
    fee: r.fee,
    currency: r.currency as CurrencyCode,
    status: r.status as TransactionStatus,
    channel: r.channel as PaymentChannel | null,
    customer: { email: r.customerEmail, name: r.customerName },
    createdAt: r.createdAt.toISOString(),
    paidAt: r.paidAt?.toISOString() ?? null,
  }
}

export function toTransaction(r: TransactionRowDb): Transaction {
  return { ...toTransactionRow(r), timeline: r.timeline as TimelineStep[] }
}

export interface TransactionQuery {
  mode: Mode
  search: string
  currency: string | null
  period: PeriodPreset | null
  from?: string
  to?: string
  /** The member's workspace and the products they may see. */
  scope: Scope
  products: string[]
  gateways: string[]
  statuses: string[]
  channels: string[]
  sort: string
  page: number
  pageSize: number
}

type Dim = "product" | "gateway" | "status" | "channel"

@Injectable()
export class TransactionsService {
  constructor(@Inject(DB) private readonly db: Db) {}

  private conditions(q: TransactionQuery) {
    const base: SQL[] = [eq(transactions.workspaceId, q.scope.workspaceId), eq(transactions.mode, q.mode)]
    const visible = productCondition(transactions.productId, q.scope)
    if (visible) base.push(visible)
    if (q.currency) base.push(eq(transactions.currency, q.currency))
    if (q.period) {
      const range = resolvePeriod(q.period, new Date(), { from: q.from, to: q.to })
      base.push(gte(transactions.createdAt, new Date(range.from)), lte(transactions.createdAt, new Date(range.to)))
    }
    if (q.search) {
      const like = `%${q.search.replace(/[%_\\]/g, "\\$&")}%`
      base.push(
        or(
          ilike(transactions.reference, like),
          ilike(transactions.customerEmail, like),
          ilike(transactions.customerName, like),
          ilike(transactions.id, like),
        )!,
      )
    }
    const dims: Record<Dim, SQL | null> = {
      product: q.products.length ? inArray(transactions.productId, q.products) : null,
      gateway: q.gateways.length ? inArray(transactions.gatewayId, q.gateways) : null,
      status: q.statuses.length ? inArray(transactions.status, q.statuses) : null,
      channel: q.channels.length ? inArray(transactions.channel, q.channels) : null,
    }
    const except = (skip: Dim | null) =>
      and(...base, ...(Object.entries(dims) as [Dim, SQL | null][]).filter(([k, v]) => k !== skip && v).map(([, v]) => v!))
    return { except, all: except(null) }
  }

  async list(q: TransactionQuery): Promise<TransactionList> {
    const { except, all } = this.conditions(q)
    const facet = async (dim: Dim, column: PgColumn) => {
      const rows = await this.db
        .select({ key: column, n: count() })
        .from(transactions)
        .where(and(except(dim), isNotNull(column)))
        .groupBy(column)
      return Object.fromEntries(rows.map((r) => [r.key as string, r.n]))
    }
    const [productsFacet, gatewaysFacet, statusesFacet, channelsFacet] = await Promise.all([
      facet("product", transactions.productId),
      facet("gateway", transactions.gatewayId),
      facet("status", transactions.status),
      facet("channel", transactions.channel),
    ])
    const [{ total }] = await this.db.select({ total: count() }).from(transactions).where(all)
    const meta = pageMeta(total, q.page, q.pageSize)
    const dir = q.sort.startsWith("-") ? desc : asc
    const order = q.sort.replace(/^-/, "") === "amount" ? dir(transactions.amount) : dir(transactions.createdAt)
    const rows = await this.db.select().from(transactions).where(all).orderBy(order, desc(transactions.id)).limit(meta.pageSize).offset(meta.offset)
    const currencies = await this.db
      .select({ currency: transactions.currency, volume: sql<string>`coalesce(sum(${transactions.amount}) filter (where ${transactions.status} = 'success'), 0)` })
      .from(transactions)
      .where(all)
      .groupBy(transactions.currency)
    const single = currencies.length === 1 ? currencies[0] : null
    return {
      rows: rows.map(toTransactionRow),
      total,
      page: meta.page,
      pageSize: meta.pageSize,
      pages: meta.pages,
      facets: { products: productsFacet, gateways: gatewaysFacet, statuses: statusesFacet, channels: channelsFacet },
      summary: { currency: (single?.currency as CurrencyCode) ?? null, volume: single ? Number(single.volume) : 0 },
    }
  }

  async findRow(workspaceId: string, idOrReference: string): Promise<TransactionRowDb | null> {
    const [row] = await this.db
      .select()
      .from(transactions)
      .where(and(eq(transactions.workspaceId, workspaceId), or(eq(transactions.id, idOrReference), eq(transactions.reference, idOrReference))))
    return row ?? null
  }

  async detail(row: TransactionRowDb): Promise<TransactionDetail> {
    const events = await this.db
      .select()
      .from(webhookEvents)
      .where(and(eq(webhookEvents.workspaceId, row.workspaceId), eq(webhookEvents.reference, row.reference)))
      .orderBy(asc(webhookEvents.receivedAt))
    const deliveries = await this.db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.transactionId, row.id))
      .orderBy(asc(webhookDeliveries.createdAt))
    return { ...toTransaction(row), events: events.map(toEventDto), deliveries: deliveries.map(toDeliveryDto) }
  }

  /** CSV of the filtered list (up to 100k rows), newest first. */
  async *csv(q: TransactionQuery): AsyncGenerator<string> {
    const { all } = this.conditions(q)
    const names = new Map(
      (await this.db.select({ id: products.id, name: products.name }).from(products).where(eq(products.workspaceId, q.scope.workspaceId))).map((p) => [p.id, p.name]),
    )
    yield `${["id", "reference", "created_at", "paid_at", "product", "gateway", "mode", "status", "channel", "amount", "fee", "currency", "customer_email", "customer_name"].join(",")}\n`
    const batch = 2_000
    for (let offset = 0; offset < 100_000; offset += batch) {
      const rows = await this.db.select().from(transactions).where(all).orderBy(desc(transactions.createdAt), desc(transactions.id)).limit(batch).offset(offset)
      for (const r of rows) {
        yield `${[
          r.id,
          r.reference,
          r.createdAt.toISOString(),
          r.paidAt?.toISOString() ?? "",
          names.get(r.productId) ?? r.productId,
          r.gatewayId,
          r.mode,
          r.status,
          r.channel ?? "",
          (r.amount / 100).toFixed(2),
          (r.fee / 100).toFixed(2),
          r.currency,
          r.customerEmail,
          r.customerName,
        ]
          .map(csvCell)
          .join(",")}\n`
      }
      if (rows.length < batch) break
    }
  }
}

/** Quotes a CSV cell and defuses spreadsheet formulas. */
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return /[",\n\r]/.test(safe) || safe !== value ? `"${safe.replace(/"/g, '""')}"` : safe
}
