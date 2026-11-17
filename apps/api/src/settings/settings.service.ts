import { Inject, Injectable } from "@nestjs/common"
import type { CurrencyCode, PlatformSettings } from "@yaropay/core/types"
import { normalizeBaseUrl } from "@yaropay/core/urls"
import { eq, sql } from "drizzle-orm"
import { EncryptionService } from "../common/encryption.service.js"
import { APP_CONFIG, type AppConfig } from "../config/config.js"
import { DB } from "../database/database.module.js"
import type { Db, DbOrTx } from "../database/db.js"
import { type SettingsRow, settings, type WorkspaceRow, workspaces } from "../database/schema.js"

export function maskUrl(url: string): string {
  try {
    const u = new URL(url)
    const tail = url.slice(-4)
    return `${u.protocol}//${u.host}/••••${tail}`
  } catch {
    return "••••"
  }
}

@Injectable()
export class SettingsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly encryption: EncryptionService,
  ) {}

  /** The settings row, created with defaults on first use. */
  async row(tx: DbOrTx = this.db): Promise<SettingsRow> {
    const [row] = await tx.select().from(settings).where(eq(settings.id, 1))
    if (row) return row
    const [created] = await tx
      .insert(settings)
      .values({ id: 1, baseUrl: this.config.defaultBaseUrl })
      .onConflictDoNothing()
      .returning()
    return created ?? (await tx.select().from(settings).where(eq(settings.id, 1)))[0]
  }

  /** Install-level values: the same for every workspace (and fixed for tenants on Cloud). */
  async install(tx?: DbOrTx): Promise<{ platformName: string; baseUrl: string; signupsOpen: boolean; signupPlan: string }> {
    const row = await this.row(tx)
    return { platformName: row.platformName, baseUrl: row.baseUrl, signupsOpen: row.signupsOpen, signupPlan: row.signupPlan }
  }

  /** Gateways turned off on this install: no new accounts on them (existing accounts keep working). */
  async disabledGateways(tx?: DbOrTx): Promise<string[]> {
    return (await this.row(tx)).disabledGateways
  }

  /** Offers a gateway to companies again, or stops offering it. Returns the new list of turned-off gateways. */
  async setGatewayOffered(gatewayId: string, offered: boolean, tx: DbOrTx = this.db): Promise<string[]> {
    await this.row(tx)
    const [row] = await tx
      .update(settings)
      .set({
        disabledGateways: offered
          ? sql`array_remove(${settings.disabledGateways}, ${gatewayId})`
          : sql`case when ${gatewayId} = any(${settings.disabledGateways}) then ${settings.disabledGateways} else array_append(${settings.disabledGateways}, ${gatewayId}) end`,
        updatedAt: new Date(),
      })
      .where(eq(settings.id, 1))
      .returning({ disabledGateways: settings.disabledGateways })
    return row.disabledGateways
  }

  /** Install values merged with the workspace's own (company name, currency, alerts). */
  async get(workspaceId: string, tx: DbOrTx = this.db): Promise<PlatformSettings> {
    const row = await this.row(tx)
    const [ws] = await tx.select().from(workspaces).where(eq(workspaces.id, workspaceId))
    if (!ws) throw new Error(`Unknown workspace ${workspaceId}`)
    return this.toDto(row, ws)
  }

  async baseUrl(): Promise<string> {
    return (await this.row()).baseUrl
  }

  async alertsWebhookUrl(workspaceId: string): Promise<string | null> {
    const [ws] = await this.db.select({ enc: workspaces.alertsWebhookUrlEnc }).from(workspaces).where(eq(workspaces.id, workspaceId))
    return ws?.enc ? this.encryption.decrypt(ws.enc) : null
  }

  async update(workspaceId: string, patch: Partial<PlatformSettings>, tx: DbOrTx = this.db): Promise<PlatformSettings> {
    await this.row(tx)
    const install: Partial<typeof settings.$inferInsert> = {}
    if (patch.platformName !== undefined) install.platformName = patch.platformName
    if (patch.baseUrl !== undefined) install.baseUrl = normalizeBaseUrl(patch.baseUrl)
    if (Object.keys(install).length) await tx.update(settings).set({ ...install, updatedAt: new Date() }).where(eq(settings.id, 1))

    const company: Partial<typeof workspaces.$inferInsert> = {}
    if (patch.companyName !== undefined) company.name = patch.companyName
    if (patch.defaultCurrency !== undefined) company.defaultCurrency = patch.defaultCurrency
    if (patch.alertsWebhookUrl !== undefined) {
      const v = patch.alertsWebhookUrl
      // A masked value means "unchanged"; empty or null clears it.
      if (!v) company.alertsWebhookUrlEnc = null
      else if (!v.includes("•")) company.alertsWebhookUrlEnc = this.encryption.encrypt(v)
    }
    if (Object.keys(company).length) await tx.update(workspaces).set({ ...company, updatedAt: new Date() }).where(eq(workspaces.id, workspaceId))
    return this.get(workspaceId, tx)
  }

  private toDto(row: SettingsRow, ws: WorkspaceRow): PlatformSettings {
    return {
      platformName: row.platformName,
      companyName: ws.name,
      baseUrl: row.baseUrl,
      defaultCurrency: ws.defaultCurrency as CurrencyCode,
      alertsWebhookUrl: ws.alertsWebhookUrlEnc ? maskUrl(this.encryption.decrypt(ws.alertsWebhookUrlEnc)) : null,
    }
  }
}
