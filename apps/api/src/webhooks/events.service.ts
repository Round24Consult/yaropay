import { Inject, Injectable } from "@nestjs/common"
import type { EventRow, Paginated } from "@yaropay/core/api"
import type { DeliveryState, GatewayId, Mode, WebhookEvent } from "@yaropay/core/types"
import { and, count, desc, eq, ilike, inArray, isNotNull, isNull, or, type SQL } from "drizzle-orm"
import { pageMeta } from "../common/query.js"
import { productCondition, type Scope } from "../auth/scope.js"
import { DB } from "../database/database.module.js"
import type { Db } from "../database/db.js"
import { transactions, type WebhookEventRow, webhookDeliveries, webhookEvents } from "../database/schema.js"

export function toEventDto(r: WebhookEventRow): WebhookEvent {
  return {
    id: r.id,
    gatewayId: r.gatewayId as GatewayId,
    connectionId: r.connectionId,
    mode: r.mode as Mode,
    type: r.type,
    reference: r.reference,
    signatureValid: r.signatureValid,
    productId: r.productId,
    receivedAt: r.receivedAt.toISOString(),
    payload: r.payload,
  }
}

@Injectable()
export class EventsService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async list(q: {
    scope: Scope
    mode: Mode
    routing: "routed" | "unrouted" | null
    /** Scoped members never see unrouted events: they belong to no product. */
    scoped: boolean
    gateways: string[]
    search: string
    page: number
    pageSize: number
  }): Promise<Paginated<EventRow>> {
    const empty = { rows: [], total: 0, page: 1, pageSize: q.pageSize, pages: 1 }
    if (q.scoped && q.routing === "unrouted") return empty
    const where: SQL[] = [eq(webhookEvents.workspaceId, q.scope.workspaceId), eq(webhookEvents.mode, q.mode)]
    if (q.routing === "unrouted") where.push(isNull(webhookEvents.productId))
    if (q.routing === "routed" || q.scoped) where.push(isNotNull(webhookEvents.productId))
    const products = productCondition(webhookEvents.productId, q.scope)
    if (products) where.push(products)
    if (q.gateways.length) where.push(inArray(webhookEvents.gatewayId, q.gateways))
    if (q.search) {
      const like = `%${q.search.replace(/[%_\\]/g, "\\$&")}%`
      where.push(or(ilike(webhookEvents.reference, like), ilike(webhookEvents.type, like), ilike(webhookEvents.id, like))!)
    }
    const filter = and(...where)
    const [{ total }] = await this.db.select({ total: count() }).from(webhookEvents).where(filter)
    const meta = pageMeta(total, q.page, q.pageSize)
    const rows = await this.db
      .select()
      .from(webhookEvents)
      .where(filter)
      .orderBy(desc(webhookEvents.receivedAt))
      .limit(meta.pageSize)
      .offset(meta.offset)
    const deliveries = await this.deliveriesFor(q.scope.workspaceId, rows)
    return {
      rows: rows.map((e) => {
        const d = deliveries.get(e.id)
        return { ...toEventDto(e), delivery: d ? { id: d.id, state: d.state as DeliveryState, statusCode: d.statusCode } : null }
      }),
      total,
      page: meta.page,
      pageSize: meta.pageSize,
      pages: meta.pages,
    }
  }

  /** The delivery each event caused, or the delivery for the same payment when the callback settled it first. */
  private async deliveriesFor(workspaceId: string, events: WebhookEventRow[]) {
    const out = new Map<string, { id: string; state: string; statusCode: number | null }>()
    if (!events.length) return out
    const direct = await this.db
      .select({ id: webhookDeliveries.id, eventId: webhookDeliveries.eventId, state: webhookDeliveries.state, statusCode: webhookDeliveries.statusCode })
      .from(webhookDeliveries)
      .where(and(eq(webhookDeliveries.workspaceId, workspaceId), inArray(webhookDeliveries.eventId, events.map((e) => e.id))))
    for (const d of direct) if (d.eventId) out.set(d.eventId, d)
    const missing = events.filter((e) => !out.has(e.id) && e.reference && e.productId)
    if (missing.length) {
      const viaTx = await this.db
        .select({ reference: transactions.reference, id: webhookDeliveries.id, state: webhookDeliveries.state, statusCode: webhookDeliveries.statusCode, createdAt: webhookDeliveries.createdAt })
        .from(webhookDeliveries)
        .innerJoin(transactions, eq(transactions.id, webhookDeliveries.transactionId))
        .where(and(eq(transactions.workspaceId, workspaceId), inArray(transactions.reference, missing.map((e) => e.reference!))))
        .orderBy(desc(webhookDeliveries.createdAt))
      const byRef = new Map<string, (typeof viaTx)[number]>()
      for (const d of viaTx) if (!byRef.has(d.reference)) byRef.set(d.reference, d)
      for (const e of missing) {
        const d = byRef.get(e.reference!)
        if (d) out.set(e.id, d)
      }
    }
    return out
  }
}
