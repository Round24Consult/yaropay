import { Inject, Injectable } from "@nestjs/common"
import type { ConnectionDetail, ConnectionTestResult, GatewayListItem } from "@yaropay/core/api"
import { buildCredentialSchema, type ConnectionInput, maskCredentials } from "@yaropay/core/gateways/credentials"
import { gatewayRegistry, getGateway, requireGateway } from "@yaropay/core/gateways/registry"
import { gatewayApiBaseUrl } from "@yaropay/core/gateways/types"
import type { ColorSlot, GatewayConnection, GatewayId, Mode } from "@yaropay/core/types"
import { and, asc, eq, sql } from "drizzle-orm"
import { AuditService } from "../audit/audit.service.js"
import type { AuditContext } from "../auth/types.js"
import { newId } from "../common/crypto.js"
import { EncryptionService } from "../common/encryption.service.js"
import { conflict, invalid, notFound, zodFields } from "../common/errors.js"
import { FETCH, type FetchFn } from "../common/http.js"
import { APP_CONFIG, type AppConfig } from "../config/config.js"
import { DB } from "../database/database.module.js"
import type { Db, DbOrTx } from "../database/db.js"
import { type ConnectionRow, connections, productGateways, products } from "../database/schema.js"
import { NotificationsService } from "../notifications/notifications.service.js"
import { adapterFor } from "./adapters.js"
import type { AdapterContext, Credentials, GatewayAdapter } from "./kit.js"

export function toConnectionDto(r: ConnectionRow): GatewayConnection {
  return {
    id: r.id,
    gatewayId: r.gatewayId as GatewayId,
    label: r.label,
    mode: r.mode as Mode,
    credentials: r.credentialsMasked,
    status: r.status as "active" | "error",
    sample: r.sample,
    createdAt: r.createdAt.toISOString(),
    lastEventAt: r.lastEventAt?.toISOString() ?? null,
  }
}

@Injectable()
export class ConnectionsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(FETCH) private readonly fetch: FetchFn,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly encryption: EncryptionService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Context the adapters use for calls to one gateway account (its gateway and mode decide the API host). */
  context(account: { gatewayId: string; mode: string }): AdapterContext {
    const gateway = requireGateway(account.gatewayId)
    const mode = account.mode as Mode
    const baseUrl = this.config.gateways.apiUrls[gateway.id] ?? gatewayApiBaseUrl(gateway, mode)
    return { fetch: this.fetch, baseUrl, mode, timeoutMs: this.config.gateways.timeoutMs }
  }

  adapter(gatewayId: string): GatewayAdapter {
    const a = adapterFor(gatewayId)
    if (!a) throw conflict(`${getGateway(gatewayId)?.name ?? gatewayId} is not supported yet`)
    return a
  }

  async rows(workspaceId: string): Promise<ConnectionRow[]> {
    return this.db.select().from(connections).where(eq(connections.workspaceId, workspaceId)).orderBy(asc(connections.createdAt))
  }

  /** By ID across the install: only for public endpoints, which take the workspace from the row. */
  async find(id: string, tx: DbOrTx = this.db): Promise<ConnectionRow | null> {
    const [row] = await tx.select().from(connections).where(eq(connections.id, id))
    return row ?? null
  }

  async findIn(workspaceId: string, id: string, tx: DbOrTx = this.db): Promise<ConnectionRow | null> {
    const [row] = await tx.select().from(connections).where(and(eq(connections.workspaceId, workspaceId), eq(connections.id, id)))
    return row ?? null
  }

  credentials(row: ConnectionRow): Credentials {
    return this.encryption.decryptJson<Credentials>(row.credentialsEnc)
  }

  async list(workspaceId: string): Promise<GatewayConnection[]> {
    return (await this.rows(workspaceId)).map(toConnectionDto)
  }

  async gateways(workspaceId: string): Promise<GatewayListItem[]> {
    const all = await this.list(workspaceId)
    return gatewayRegistry.map((gateway) => ({ gateway, connections: all.filter((c) => c.gatewayId === gateway.id) }))
  }

  async detail(workspaceId: string, id: string): Promise<ConnectionDetail> {
    const row = await this.findIn(workspaceId, id)
    if (!row) throw notFound("Connection")
    const used = await this.db
      .select({ id: products.id, name: products.name, colorSlot: products.colorSlot, referencePrefix: products.referencePrefix })
      .from(productGateways)
      .innerJoin(products, eq(products.id, productGateways.productId))
      .where(and(eq(productGateways.workspaceId, workspaceId), eq(productGateways.connectionId, id)))
      .orderBy(asc(products.createdAt))
    return {
      connection: toConnectionDto(row),
      gateway: requireGateway(row.gatewayId),
      products: used.map((p) => ({ ...p, colorSlot: p.colorSlot as ColorSlot })),
    }
  }

  private validateCredentials(gatewayId: string, mode: Mode, credentials: Record<string, string>) {
    const gateway = getGateway(gatewayId)
    if (!gateway) throw notFound("Gateway")
    if (gateway.status !== "available") throw conflict(`${gateway.name} is not available yet`)
    const parsed = buildCredentialSchema(gateway, mode).safeParse(credentials)
    if (!parsed.success) throw invalid(zodFields(parsed.error, "credentials."), "Some credentials need attention")
    const clean: Credentials = {}
    for (const f of gateway.credentialFields) {
      const v = (parsed.data as Record<string, string | undefined>)[f.key]
      if (v) clean[f.key] = v
    }
    return { gateway, clean }
  }

  async install(input: ConnectionInput, ctx: AuditContext): Promise<GatewayConnection> {
    const { gateway, clean } = this.validateCredentials(input.gatewayId, input.mode, input.credentials)
    const [dupe] = await this.db
      .select({ id: connections.id })
      .from(connections)
      .where(
        and(
          eq(connections.workspaceId, ctx.workspaceId),
          sql`${connections.gatewayId} = ${gateway.id} and ${connections.mode} = ${input.mode} and lower(${connections.label}) = ${input.label.toLowerCase()}`,
        ),
      )
    if (dupe) throw invalid({ label: `You already have a ${gateway.name} account with this name` })
    const [row] = await this.db
      .insert(connections)
      .values({
        id: newId("con", 10),
        workspaceId: ctx.workspaceId,
        gatewayId: gateway.id,
        label: input.label,
        mode: input.mode,
        credentialsEnc: this.encryption.encryptJson(clean),
        credentialsMasked: maskCredentials(gateway, clean),
      })
      .returning()
    await this.audit.record(ctx, "Installed app", `${gateway.name}, ${row.label} (${row.mode})`)
    return toConnectionDto(row)
  }

  async update(id: string, input: { label?: string; credentials?: Record<string, string> }, ctx: AuditContext): Promise<ConnectionDetail> {
    const row = await this.findIn(ctx.workspaceId, id)
    if (!row) throw notFound("Connection")
    const values: Partial<typeof connections.$inferInsert> = {}
    if (input.label) values.label = input.label
    if (input.credentials) {
      const { gateway, clean } = this.validateCredentials(row.gatewayId, row.mode as Mode, input.credentials)
      values.credentialsEnc = this.encryption.encryptJson(clean)
      values.credentialsMasked = maskCredentials(gateway, clean)
      values.status = "active"
      values.lastError = null
    }
    if (Object.keys(values).length) await this.db.update(connections).set(values).where(eq(connections.id, id))
    const gatewayName = requireGateway(row.gatewayId).name
    if (input.credentials) {
      await this.audit.record(ctx, "Rotated gateway keys", `${gatewayName}, ${row.label}`)
      await this.notifications.notify({
        workspaceId: ctx.workspaceId,
        type: "keys.rotated",
        title: `${gatewayName} keys rotated`,
        body: `${ctx.actorName} replaced the keys for ${gatewayName} · ${row.label} (${row.mode}).`,
        link: `/apps/${id}`,
      })
    } else if (input.label) {
      await this.audit.record(ctx, "Renamed app", `${gatewayName}, ${input.label}`)
    }
    return this.detail(ctx.workspaceId, id)
  }

  async remove(id: string, force: boolean, ctx: AuditContext) {
    const detail = await this.detail(ctx.workspaceId, id)
    if (detail.products.length && !force) {
      throw conflict(`Used by ${detail.products.map((p) => p.name).join(", ")}. Detach it from those products first.`)
    }
    await this.db.transaction(async (tx) => {
      const affected = detail.products.map((p) => p.id)
      await tx.delete(productGateways).where(eq(productGateways.connectionId, id))
      // Products that lost their default fall back to their next gateway.
      for (const productId of affected) {
        const rest = await tx.select().from(productGateways).where(eq(productGateways.productId, productId)).orderBy(asc(productGateways.position))
        if (rest.length && !rest.some((g) => g.isDefault)) {
          await tx
            .update(productGateways)
            .set({ isDefault: true })
            .where(sql`${productGateways.productId} = ${productId} and ${productGateways.connectionId} = ${rest[0].connectionId}`)
        }
      }
      await tx.delete(connections).where(and(eq(connections.workspaceId, ctx.workspaceId), eq(connections.id, id)))
    })
    await this.audit.record(ctx, "Uninstalled app", `${detail.gateway.name}, ${detail.connection.label}`)
  }

  /** Calls the gateway with keys that are not saved yet (the install form's "Test connection"). */
  async test(input: { gatewayId: string; mode: Mode; credentials: Record<string, string> }): Promise<ConnectionTestResult> {
    const gateway = getGateway(input.gatewayId)
    if (!gateway) throw notFound("Gateway")
    const parsed = buildCredentialSchema(gateway, input.mode).safeParse(input.credentials)
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Credentials were rejected" }
    const adapter = this.adapter(gateway.id)
    return adapter.testConnection(this.context({ gatewayId: gateway.id, mode: input.mode }), parsed.data as Credentials)
  }

  /** Records a gateway failure on the account and tells the people who manage gateways. */
  async markError(row: ConnectionRow, message: string) {
    await this.db.update(connections).set({ status: "error", lastError: message }).where(eq(connections.id, row.id))
    const name = requireGateway(row.gatewayId).name
    await this.notifications.notify({
      workspaceId: row.workspaceId,
      type: "gateway.error",
      severity: "critical",
      title: `${name} rejected a request`,
      body: `${name} · ${row.label} (${row.mode}): ${message}. Payments through this account are failing until the keys are fixed.`,
      link: `/apps/${row.id}`,
      throttleKey: row.id,
      throttleMs: 30 * 60_000,
    })
  }

  async markActive(row: ConnectionRow) {
    if (row.status !== "active") await this.db.update(connections).set({ status: "active", lastError: null }).where(eq(connections.id, row.id))
  }

  async touch(id: string, at = new Date()) {
    await this.db.update(connections).set({ lastEventAt: at }).where(eq(connections.id, id))
  }
}
