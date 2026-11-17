import { Inject, Injectable } from "@nestjs/common"
import type { CreatedProduct, ProductStats, ProductWithStats, RotatedSecret, RotateTarget } from "@yaropay/core/api"
import { API_KEY_PREFIX, SIGNING_SECRET_PREFIX } from "@yaropay/core/payments"
import { httpsIssues, type ProductInput } from "@yaropay/core/schemas"
import type { ColorSlot, CurrencyCode, Mode, Product, ProductGateway } from "@yaropay/core/types"
import { and, asc, count, eq, inArray, sql } from "drizzle-orm"
import { AuditService } from "../audit/audit.service.js"
import type { AuditContext } from "../auth/types.js"
import { newId, randomSecret, secretPreview, sha256 } from "../common/crypto.js"
import { EncryptionService } from "../common/encryption.service.js"
import { conflict, invalid, notFound } from "../common/errors.js"
import { DB } from "../database/database.module.js"
import { type Db, type DbOrTx, rowsOf } from "../database/db.js"
import { productCondition, type Scope } from "../auth/scope.js"
import { connections, type ProductRow, productGateways, products, transactions } from "../database/schema.js"
import { NotificationsService } from "../notifications/notifications.service.js"
import { SettingsService } from "../settings/settings.service.js"

const DAY = 86_400_000

export function slugify(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "product"
}

export function toProductDto(row: ProductRow, gateways: ProductGateway[]): Product {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    kind: row.kind as Product["kind"],
    websiteUrl: row.websiteUrl,
    colorSlot: row.colorSlot as ColorSlot,
    referencePrefix: row.referencePrefix,
    gateways,
    webhookUrl: row.webhookUrl,
    successUrl: row.successUrl,
    failureUrl: row.failureUrl,
    cancelUrl: row.cancelUrl,
    apiKeyPreview: row.liveKeyPreview,
    testApiKeyPreview: row.testKeyPreview,
    signingSecretPreview: row.signingSecretPreview,
    status: row.status as Product["status"],
    sample: row.sample,
    createdAt: row.createdAt.toISOString(),
  }
}

function newKeys() {
  const live = randomSecret(API_KEY_PREFIX.live)
  const test = randomSecret(API_KEY_PREFIX.test)
  const signing = randomSecret(SIGNING_SECRET_PREFIX)
  return { live, test, signing }
}

@Injectable()
export class ProductsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly encryption: EncryptionService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
  ) {}

  async gatewaysOf(productIds: string[], tx: DbOrTx = this.db): Promise<Map<string, ProductGateway[]>> {
    const map = new Map<string, ProductGateway[]>()
    if (!productIds.length) return map
    const rows = await tx
      .select()
      .from(productGateways)
      .where(inArray(productGateways.productId, productIds))
      .orderBy(asc(productGateways.position))
    for (const r of rows) {
      const list = map.get(r.productId) ?? []
      list.push({ connectionId: r.connectionId, isDefault: r.isDefault })
      map.set(r.productId, list)
    }
    return map
  }

  /** By ID across the install: only for public endpoints, which take the workspace from the row. */
  async row(id: string, tx: DbOrTx = this.db): Promise<ProductRow | null> {
    const [row] = await tx.select().from(products).where(eq(products.id, id))
    return row ?? null
  }

  async rowIn(workspaceId: string, id: string, tx: DbOrTx = this.db): Promise<ProductRow | null> {
    const [row] = await tx.select().from(products).where(and(eq(products.workspaceId, workspaceId), eq(products.id, id)))
    return row ?? null
  }

  async dto(row: ProductRow, tx: DbOrTx = this.db): Promise<Product> {
    return toProductDto(row, (await this.gatewaysOf([row.id], tx)).get(row.id) ?? [])
  }

  /** All products the scope allows, oldest first. */
  async rows(scope: Scope): Promise<ProductRow[]> {
    return this.db
      .select()
      .from(products)
      .where(and(eq(products.workspaceId, scope.workspaceId), productCondition(products.id, scope)))
      .orderBy(asc(products.createdAt))
  }

  async listWithStats(scope: Scope): Promise<ProductWithStats[]> {
    const rows = await this.rows(scope)
    const gateways = await this.gatewaysOf(rows.map((r) => r.id))
    const stats = await this.stats(scope.workspaceId, rows.map((r) => r.id))
    return rows.map((r) => ({ ...toProductDto(r, gateways.get(r.id) ?? []), stats: stats.get(r.id)! }))
  }

  async getWithStats(workspaceId: string, idOrSlug: string): Promise<ProductWithStats | null> {
    const [row] = await this.db
      .select()
      .from(products)
      .where(and(eq(products.workspaceId, workspaceId), sql`(${products.id} = ${idOrSlug} or ${products.slug} = ${idOrSlug})`))
    if (!row) return null
    const stats = await this.stats(workspaceId, [row.id])
    return { ...(await this.dto(row)), stats: stats.get(row.id)! }
  }

  /** 30-day live stats in the default currency, a 15-point sparkline and 7-day delivery health. */
  async stats(workspaceId: string, productIds: string[], now = Date.now()): Promise<Map<string, ProductStats>> {
    const out = new Map<string, ProductStats>()
    if (!productIds.length) return out
    const currency = (await this.settings.get(workspaceId)).defaultCurrency as CurrencyCode
    const from = new Date(now - 30 * DAY)
    const prevFrom = new Date(now - 60 * DAY)
    for (const id of productIds) {
      out.set(id, { currency, volume30d: 0, previousVolume30d: 0, count30d: 0, successRate30d: 0, deliveryHealth: 1, spark: new Array(15).fill(0) })
    }
    const ids = sql.join(productIds.map((id) => sql`${id}`), sql`, `)
    const totals = rowsOf<{ product_id: string; recent: boolean; success: string; attempts: string; volume: string }>(
      await this.db.execute(sql`
        select product_id,
               created_at >= ${from} as recent,
               count(*) filter (where status = 'success') as success,
               count(*) filter (where status in ('success', 'failed', 'abandoned')) as attempts,
               coalesce(sum(amount) filter (where status = 'success' and currency = ${currency}), 0) as volume
        from transactions
        where workspace_id = ${workspaceId} and mode = 'live' and created_at >= ${prevFrom} and product_id in (${ids})
        group by product_id, recent`),
    )
    for (const t of totals) {
      const s = out.get(t.product_id)!
      if (t.recent) {
        s.volume30d = Number(t.volume)
        s.count30d = Number(t.success)
        s.successRate30d = Number(t.attempts) ? Number(t.success) / Number(t.attempts) : 0
      } else {
        s.previousVolume30d = Number(t.volume)
      }
    }
    const spark = rowsOf<{ product_id: string; slot: number; volume: string }>(
      await this.db.execute(sql`
        select product_id,
               least(14, floor(extract(epoch from (created_at - ${from}::timestamptz)) / ${2 * 86_400})::int) as slot,
               sum(amount) as volume
        from transactions
        where workspace_id = ${workspaceId} and mode = 'live' and status = 'success' and currency = ${currency} and created_at >= ${from} and product_id in (${ids})
        group by 1, 2`),
    )
    for (const p of spark) out.get(p.product_id)!.spark[Number(p.slot)] = Number(p.volume)
    const health = rowsOf<{ product_id: string; total: string; delivered: string }>(
      await this.db.execute(sql`
        select product_id, count(*) as total, count(*) filter (where state = 'delivered') as delivered
        from webhook_deliveries
        where workspace_id = ${workspaceId} and created_at >= ${new Date(now - 7 * DAY)} and product_id in (${ids}) and event_type <> 'test.ping'
        group by product_id`),
    )
    for (const h of health) out.get(h.product_id)!.deliveryHealth = Number(h.total) ? Number(h.delivered) / Number(h.total) : 1
    return out
  }

  private async validate(workspaceId: string, input: Partial<ProductInput>, exceptId: string | null, tx: DbOrTx) {
    const fields: Record<string, string> = {}
    const inWs = eq(products.workspaceId, workspaceId)
    if (input.referencePrefix) {
      const [hit] = await tx.select({ id: products.id }).from(products).where(and(inWs, eq(products.referencePrefix, input.referencePrefix)))
      if (hit && hit.id !== exceptId) fields.referencePrefix = "Another product already uses this prefix"
    }
    if (input.name) {
      const [hit] = await tx
        .select({ id: products.id })
        .from(products)
        .where(and(inWs, sql`lower(${products.name}) = ${input.name.toLowerCase()}`))
      if (hit && hit.id !== exceptId) fields.name = "A product with this name already exists"
    }
    let modes: Mode[] = []
    if (input.gateways) {
      const ids = input.gateways.map((g) => g.connectionId)
      const found = ids.length
        ? await tx
            .select({ id: connections.id, mode: connections.mode, sample: connections.sample })
            .from(connections)
            .where(and(eq(connections.workspaceId, workspaceId), inArray(connections.id, ids)))
        : []
      if (found.length !== new Set(ids).size) fields.gateways = "One of the selected gateways is no longer installed"
      else if (found.some((f) => f.sample)) {
        // Sample accounts hold fake keys and are deleted with the sample data, so only sample products may use them.
        const [self] = exceptId ? await tx.select({ sample: products.sample }).from(products).where(and(inWs, eq(products.id, exceptId))) : []
        if (!self?.sample) fields.gateways = "Sample gateway accounts can't be used by your own products. Connect your own account in Apps."
      }
      modes = found.map((f) => f.mode as Mode)
    }
    return { fields, modes }
  }

  async create(input: ProductInput, ctx: AuditContext): Promise<CreatedProduct> {
    const keys = newKeys()
    const created = await this.db.transaction(async (tx) => {
      const { fields, modes } = await this.validate(ctx.workspaceId, input, null, tx)
      if (modes.includes("live")) Object.assign(fields, httpsIssues({ webhookUrl: input.webhookUrl }))
      if (Object.keys(fields).length) throw invalid(fields)
      const base = slugify(input.name)
      let slug = base
      const taken = async (s: string) =>
        (await tx.select({ id: products.id }).from(products).where(and(eq(products.workspaceId, ctx.workspaceId), eq(products.slug, s)))).length > 0
      for (let i = 2; await taken(slug); i++) slug = `${base}-${i}`
      const [row] = await tx
        .insert(products)
        .values({
          id: newId("prd", 10),
          workspaceId: ctx.workspaceId,
          name: input.name,
          slug,
          kind: input.kind,
          websiteUrl: input.websiteUrl,
          colorSlot: input.colorSlot,
          referencePrefix: input.referencePrefix,
          webhookUrl: input.webhookUrl,
          successUrl: input.successUrl,
          failureUrl: input.failureUrl,
          cancelUrl: input.cancelUrl ? input.cancelUrl : null,
          liveKeyHash: sha256(keys.live),
          liveKeyPreview: secretPreview(keys.live, API_KEY_PREFIX.live),
          testKeyHash: sha256(keys.test),
          testKeyPreview: secretPreview(keys.test, API_KEY_PREFIX.test),
          signingSecretEnc: this.encryption.encrypt(keys.signing),
          signingSecretPreview: secretPreview(keys.signing, SIGNING_SECRET_PREFIX),
        })
        .returning()
      await tx.insert(productGateways).values(
        input.gateways.map((g, i) => ({ workspaceId: ctx.workspaceId, productId: row.id, connectionId: g.connectionId, isDefault: g.isDefault, position: i })),
      )
      await this.audit.record(ctx, "Created product", row.name, tx)
      return this.dto(row, tx)
    })
    return { product: created, apiKey: keys.live, testApiKey: keys.test, signingSecret: keys.signing }
  }

  async update(id: string, input: Partial<ProductInput> & { status?: "active" | "paused" }, ctx: AuditContext): Promise<ProductWithStats> {
    await this.db.transaction(async (tx) => {
      const row = await this.rowIn(ctx.workspaceId, id, tx)
      if (!row) throw notFound("Product")
      const { fields, modes } = await this.validate(ctx.workspaceId, input, id, tx)
      const effectiveModes = input.gateways
        ? modes
        : (
            await tx
              .select({ mode: connections.mode })
              .from(productGateways)
              .innerJoin(connections, eq(connections.id, productGateways.connectionId))
              .where(eq(productGateways.productId, id))
          ).map((m) => m.mode as Mode)
      if (effectiveModes.includes("live") && input.webhookUrl) Object.assign(fields, httpsIssues({ webhookUrl: input.webhookUrl }))
      if (Object.keys(fields).length) throw invalid(fields)
      const values: Partial<typeof products.$inferInsert> = { updatedAt: new Date() }
      for (const key of ["name", "kind", "websiteUrl", "colorSlot", "referencePrefix", "webhookUrl", "successUrl", "failureUrl", "status"] as const) {
        if (input[key] !== undefined) (values as Record<string, unknown>)[key] = input[key]
      }
      if (input.cancelUrl !== undefined) values.cancelUrl = input.cancelUrl || null
      await tx.update(products).set(values).where(and(eq(products.workspaceId, ctx.workspaceId), eq(products.id, id)))
      if (input.gateways) {
        await tx.delete(productGateways).where(and(eq(productGateways.workspaceId, ctx.workspaceId), eq(productGateways.productId, id)))
        await tx.insert(productGateways).values(
          input.gateways.map((g, i) => ({ workspaceId: ctx.workspaceId, productId: id, connectionId: g.connectionId, isDefault: g.isDefault, position: i })),
        )
      }
      const what = input.status && Object.keys(input).length === 1 ? (input.status === "paused" ? "Paused product" : "Resumed product") : "Updated product"
      await this.audit.record(ctx, what, input.name ?? row.name, tx)
    })
    return (await this.getWithStats(ctx.workspaceId, id))!
  }

  /** Products with live payment history can't be deleted (pause them instead); the records are kept for accounting. */
  async remove(id: string, ctx: AuditContext) {
    const row = await this.rowIn(ctx.workspaceId, id)
    if (!row) throw notFound("Product")
    const [{ n }] = await this.db
      .select({ n: count() })
      .from(transactions)
      .where(and(eq(transactions.productId, id), eq(transactions.mode, "live")))
    if (n > 0) throw conflict(`${row.name} has ${n} live payment${n === 1 ? "" : "s"} on record. Pause it instead, so the history stays intact.`)
    await this.db.delete(products).where(and(eq(products.workspaceId, ctx.workspaceId), eq(products.id, id)))
    await this.audit.record(ctx, "Deleted product", row.name)
  }

  async rotate(id: string, which: RotateTarget, ctx: AuditContext): Promise<RotatedSecret> {
    const row = await this.rowIn(ctx.workspaceId, id)
    if (!row) throw notFound("Product")
    let secret: string
    let preview: string
    let label: string
    if (which === "signingSecret") {
      secret = randomSecret(SIGNING_SECRET_PREFIX)
      preview = secretPreview(secret, SIGNING_SECRET_PREFIX)
      label = "webhook signing secret"
      await this.db.update(products).set({ signingSecretEnc: this.encryption.encrypt(secret), signingSecretPreview: preview, updatedAt: new Date() }).where(eq(products.id, id))
    } else {
      const mode: Mode = which === "apiKey" ? "live" : "test"
      secret = randomSecret(API_KEY_PREFIX[mode])
      preview = secretPreview(secret, API_KEY_PREFIX[mode])
      label = `${mode} API key`
      await this.db
        .update(products)
        .set(mode === "live" ? { liveKeyHash: sha256(secret), liveKeyPreview: preview, updatedAt: new Date() } : { testKeyHash: sha256(secret), testKeyPreview: preview, updatedAt: new Date() })
        .where(eq(products.id, id))
    }
    await this.audit.record(ctx, `Rotated ${label}`, row.name)
    await this.notifications.notify({
      workspaceId: ctx.workspaceId,
      type: "keys.rotated",
      productId: id,
      title: `${row.name}: ${label} rotated`,
      body: `${ctx.actorName} replaced the ${label}. The old one stopped working immediately.`,
      link: `/products/${id}?tab=settings`,
    })
    return { which, secret, preview }
  }

  /** Product server authentication: the key decides the product and the mode. */
  async findByApiKey(key: string): Promise<{ product: ProductRow; mode: Mode } | null> {
    const hash = sha256(key)
    const [row] = await this.db
      .select()
      .from(products)
      .where(sql`${products.liveKeyHash} = ${hash} or ${products.testKeyHash} = ${hash}`)
    if (!row) return null
    return { product: row, mode: row.liveKeyHash === hash ? "live" : "test" }
  }

  signingSecret(row: ProductRow): string {
    return this.encryption.decrypt(row.signingSecretEnc)
  }

  /** A workspace's products with id and prefix, for routing its gateway webhooks. */
  async routingTable(workspaceId: string) {
    return this.db.select({ id: products.id, referencePrefix: products.referencePrefix }).from(products).where(eq(products.workspaceId, workspaceId))
  }
}

