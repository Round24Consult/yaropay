import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from "@nestjs/common"
import type { DeliveryList } from "@yaropay/core/api"
import { PLATFORM_DELIVERY_HEADER, PLATFORM_EVENT_HEADER, type ProductEvent } from "@yaropay/core/payments"
import type { DeliveryState, Mode, WebhookDelivery } from "@yaropay/core/types"
import { PLATFORM_SIGNATURE_HEADER } from "@yaropay/core/urls"
import { and, asc, count, desc, eq, gte, inArray, isNull, lte, or, sql, type SQL } from "drizzle-orm"
import { newId } from "../common/crypto.js"
import { startLoop } from "../common/loop.js"
import { EncryptionService } from "../common/encryption.service.js"
import { conflict, notFound } from "../common/errors.js"
import { FETCH, type FetchFn } from "../common/http.js"
import { pageMeta } from "../common/query.js"
import { assertPublicUrl } from "../common/ssrf.js"
import { APP_CONFIG, type AppConfig } from "../config/config.js"
import { DB } from "../database/database.module.js"
import { type Db, type DbOrTx, rowsOf } from "../database/db.js"
import { type ProductRow, products, transactions, type WebhookDeliveryRow, webhookDeliveries } from "../database/schema.js"
import { productCondition, type Scope } from "../auth/scope.js"
import { NotificationsService } from "../notifications/notifications.service.js"
import { signPayload } from "./signing.js"
import { OperatorSettingsService } from "../settings/operator-settings.service.js"

/** Wait before attempt n+1 (attempt 1 is immediate). 8 attempts over about 45 hours. */
export const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000, 6 * 3_600_000, 12 * 3_600_000, 24 * 3_600_000]
export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1
const LOCK_MS = 60_000

export function toDeliveryDto(r: WebhookDeliveryRow): WebhookDelivery {
  return {
    id: r.id,
    eventId: r.eventId,
    transactionId: r.transactionId,
    productId: r.productId,
    mode: r.mode as Mode,
    url: r.url,
    eventType: r.eventType,
    state: r.state as DeliveryState,
    statusCode: r.statusCode,
    attempts: r.attempts,
    nextRetryAt: r.nextRetryAt?.toISOString() ?? null,
    latencyMs: r.latencyMs,
    createdAt: r.createdAt.toISOString(),
    lastAttemptAt: r.lastAttemptAt?.toISOString() ?? null,
    responseSnippet: r.responseSnippet,
  }
}

@Injectable()
export class DeliveriesService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger("Deliveries")
  private loop: { stop: () => void } | null = null
  private running = false

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(FETCH) private readonly fetch: FetchFn,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly encryption: EncryptionService,
    private readonly notifications: NotificationsService,
    private readonly operator: OperatorSettingsService,
  ) {}

  onApplicationBootstrap() {
    if (!this.config.workers) return
    this.loop = startLoop(() => this.operator.workerIntervalMs(), () => this.tick())
  }

  onModuleDestroy() {
    this.loop?.stop()
  }

  private async tick() {
    if (this.running) return
    this.running = true
    try {
      await this.runDue()
    } catch (e) {
      this.logger.error(`Delivery tick failed: ${(e as Error).message}`)
    } finally {
      this.running = false
    }
  }

  /** Queues an event for a product. The worker sends it within a couple of seconds. */
  async enqueue(
    input: { product: ProductRow; event: ProductEvent; transactionId: string | null; eventId: string | null },
    tx: DbOrTx = this.db,
  ): Promise<WebhookDeliveryRow> {
    const [row] = await tx
      .insert(webhookDeliveries)
      .values({
        id: newId("dlv"),
        workspaceId: input.product.workspaceId,
        eventId: input.eventId,
        transactionId: input.transactionId,
        productId: input.product.id,
        mode: input.event.mode,
        url: input.product.webhookUrl,
        eventType: input.event.type,
        payload: input.event as unknown as Record<string, unknown>,
        state: "pending",
        nextRetryAt: new Date(),
      })
      .returning()
    return row
  }

  /** Sends every due delivery once. Returns how many were attempted. Tests call this directly. */
  async runDue(limit = 10): Promise<number> {
    const now = new Date()
    const claimed = await this.db.transaction(async (tx) => {
      // Take turns between companies: each one's oldest due delivery first, then each one's second, and
      // so on, so a company with a big backlog can't hold everyone else's deliveries up.
      const fair = rowsOf<{ id: string }>(
        await tx.execute(sql`
          select id from (
            select d.id, d.next_retry_at, row_number() over (partition by d.workspace_id order by d.next_retry_at) as turn
            from webhook_deliveries d
            join products p on p.workspace_id = d.workspace_id and p.id = d.product_id
            where d.state in ('pending', 'retrying')
              and d.next_retry_at <= ${now.toISOString()}::timestamptz
              and (d.locked_until is null or d.locked_until <= ${now.toISOString()}::timestamptz)
              -- Sample products point at made-up hosts: only a manual replay sends to them.
              and not p.sample
          ) due
          order by turn, next_retry_at
          limit ${limit}
        `),
      )
      if (!fair.length) return []
      const due = await tx
        .select()
        .from(webhookDeliveries)
        .where(
          and(
            inArray(
              webhookDeliveries.id,
              fair.map((r) => r.id),
            ),
            or(isNull(webhookDeliveries.lockedUntil), lte(webhookDeliveries.lockedUntil, now)),
          ),
        )
        .for("update", { skipLocked: true })
      if (due.length) {
        await tx
          .update(webhookDeliveries)
          .set({ lockedUntil: new Date(now.getTime() + LOCK_MS) })
          .where(inArray(webhookDeliveries.id, due.map((d) => d.id)))
      }
      return due
    })
    await Promise.all(claimed.map((d) => this.attempt(d, false)))
    return claimed.length
  }

  /** Sends one delivery right now (replay, test event). Returns the updated delivery. */
  async sendNow(id: string, manual = true): Promise<WebhookDelivery> {
    const now = new Date()
    const [row] = await this.db
      .update(webhookDeliveries)
      .set({ lockedUntil: new Date(now.getTime() + LOCK_MS) })
      .where(and(eq(webhookDeliveries.id, id), or(isNull(webhookDeliveries.lockedUntil), lte(webhookDeliveries.lockedUntil, now))))
      .returning()
    if (!row) {
      const [exists] = await this.db.select({ id: webhookDeliveries.id }).from(webhookDeliveries).where(eq(webhookDeliveries.id, id))
      if (!exists) throw notFound("Delivery")
      throw conflict("This delivery is being sent right now. Try again in a moment.")
    }
    return toDeliveryDto(await this.attempt(row, manual))
  }

  private async attempt(row: WebhookDeliveryRow, manual: boolean): Promise<WebhookDeliveryRow> {
    const [product] = await this.db.select().from(products).where(eq(products.id, row.productId))
    const attempts = row.attempts + 1
    const started = Date.now()
    let statusCode: number | null = null
    let latencyMs: number | null = null
    let snippet = ""
    let ok = false
    // Always deliver to the product's current URL, so fixing the URL and replaying works.
    const url = product?.webhookUrl ?? row.url

    if (!product) {
      snippet = "Product was deleted"
    } else {
      const body = JSON.stringify(row.payload)
      const timeoutMs = this.operator.webhookTimeoutMs()
      try {
        if (!this.config.webhookAllowPrivate) await assertPublicUrl(url)
        const res = await this.fetch(url, {
          method: "POST",
          redirect: "manual",
          headers: {
            "content-type": "application/json",
            "user-agent": "YaroPay-Webhooks/1.0",
            [PLATFORM_EVENT_HEADER]: row.eventType,
            [PLATFORM_DELIVERY_HEADER]: row.id,
            [PLATFORM_SIGNATURE_HEADER]: signPayload(this.encryption.decrypt(product.signingSecretEnc), body),
          },
          body,
          signal: AbortSignal.timeout(timeoutMs),
        })
        statusCode = res.status
        latencyMs = Date.now() - started
        snippet = (await res.text().catch(() => "")).slice(0, 300)
        ok = res.status >= 200 && res.status < 300
        if (res.status >= 300 && res.status < 400) snippet = `Redirects are not followed (Location: ${res.headers.get("location") ?? "?"})`
      } catch (e) {
        const err = e as Error
        snippet = err.name === "TimeoutError" ? `No response within ${timeoutMs} ms` : err.message.slice(0, 300)
      }
    }

    const exhausted = attempts >= MAX_ATTEMPTS || !product
    const state: DeliveryState = ok ? "delivered" : exhausted ? "failed" : "retrying"
    const now = new Date()
    const nextRetryAt = state === "retrying" ? new Date(now.getTime() + RETRY_DELAYS_MS[Math.min(attempts - 1, RETRY_DELAYS_MS.length - 1)]) : null
    const [updated] = await this.db
      .update(webhookDeliveries)
      .set({ attempts, state, statusCode, latencyMs, responseSnippet: snippet, lastAttemptAt: now, nextRetryAt, lockedUntil: null, url })
      .where(eq(webhookDeliveries.id, row.id))
      .returning()

    if (row.transactionId && product) {
      const step = {
        kind: "forwarded",
        at: now.toISOString(),
        title: ok
          ? `${manual ? "Replayed" : "Forwarded"} to ${product.name}`
          : state === "failed"
            ? `Delivery to ${product.name} failed`
            : `Delivery to ${product.name} is retrying`,
        detail: ok
          ? `${statusCode} in ${latencyMs} ms, signed with ${PLATFORM_SIGNATURE_HEADER}`
          : `${statusCode ?? "No response"} on attempt ${attempts}${nextRetryAt ? `, next try ${nextRetryAt.toISOString()}` : ""}`,
        ok,
      }
      await this.db
        .update(transactions)
        .set({ timeline: sql`${transactions.timeline} || ${JSON.stringify([step])}::jsonb`, updatedAt: now })
        .where(eq(transactions.id, row.transactionId))
    }

    if (!ok && product && row.eventType !== "test.ping" && !manual) {
      if (state === "failed") {
        await this.notifications.notify({
          workspaceId: product.workspaceId,
          type: "delivery.failed",
          productId: product.id,
          severity: "critical",
          title: `${product.name} stopped accepting events`,
          body: `A ${row.eventType} event could not be delivered to ${url} after ${attempts} attempts (last answer: ${statusCode ?? snippet}). Fix the endpoint, then replay it.`,
          link: "/webhooks?tab=deliveries&state=failed",
        })
      } else if (attempts === 3) {
        await this.notifications.notify({
          workspaceId: product.workspaceId,
          type: "delivery.failed",
          productId: product.id,
          severity: "warning",
          title: `Deliveries to ${product.name} are failing`,
          body: `${url} answered ${statusCode ?? snippet} three times in a row. YaroPay keeps retrying for about two days.`,
          link: "/webhooks?tab=deliveries&state=retrying",
          throttleKey: product.id,
          throttleMs: 60 * 60_000,
        })
      }
    }
    return updated
  }

  async list(q: {
    scope: Scope
    mode: Mode
    states: string[]
    sinceDays: number
    page: number
    pageSize: number
  }): Promise<DeliveryList> {
    const products = productCondition(webhookDeliveries.productId, q.scope)
    const base: SQL[] = [eq(webhookDeliveries.workspaceId, q.scope.workspaceId), eq(webhookDeliveries.mode, q.mode)]
    if (q.sinceDays > 0) base.push(gte(webhookDeliveries.createdAt, new Date(Date.now() - q.sinceDays * 86_400_000)))
    if (products) base.push(products)
    const where = q.states.length ? and(...base, inArray(webhookDeliveries.state, q.states)) : and(...base)
    const [{ total }] = await this.db.select({ total: count() }).from(webhookDeliveries).where(where)
    const meta = pageMeta(total, q.page, q.pageSize)
    const rows = await this.db
      .select()
      .from(webhookDeliveries)
      .where(where)
      .orderBy(desc(webhookDeliveries.createdAt))
      .limit(meta.pageSize)
      .offset(meta.offset)
    const counts = await this.db
      .select({ state: webhookDeliveries.state, n: count() })
      .from(webhookDeliveries)
      .where(and(...base))
      .groupBy(webhookDeliveries.state)
    return {
      rows: rows.map(toDeliveryDto),
      total,
      page: meta.page,
      pageSize: meta.pageSize,
      pages: meta.pages,
      counts: Object.fromEntries(counts.map((c) => [c.state, c.n])),
    }
  }

  async find(workspaceId: string, id: string) {
    const [row] = await this.db.select().from(webhookDeliveries).where(and(eq(webhookDeliveries.workspaceId, workspaceId), eq(webhookDeliveries.id, id)))
    return row ?? null
  }
}
