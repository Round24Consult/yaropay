import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common"
import type { OperatorSettingKey } from "@yaropay/core/platform"
import { eq, sql } from "drizzle-orm"
import { EncryptionService } from "../common/encryption.service.js"
import { DB } from "../database/database.module.js"
import type { Db } from "../database/db.js"
import { settings } from "../database/schema.js"
import { SettingsService } from "./settings.service.js"

/** Values saved in the platform console. Null: not saved, so the server's env value applies. */
export interface OperatorOverrides {
  billingPaystackSecretKey: string | null
  smtpUrl: string | null
  mailFrom: string | null
  v1RateLimitPerMinute: number | null
}

const EMPTY: OperatorOverrides = { billingPaystackSecretKey: null, smtpUrl: null, mailFrom: null, v1RateLimitPerMinute: null }

/**
 * Other API instances pick up a change within this long; the instance that saved it, at once. Reading
 * the row is one small query, so this keeps every instance in step without a message bus.
 */
export const OPERATOR_SETTINGS_TTL_MS = 10_000

/**
 * Operator settings the super admin can change from the console instead of the server's .env (billing
 * key, email, product API limit). Each consumer applies its own precedence: the saved value if there is
 * one, otherwise its env value. Kept in memory so hot paths (the per-request rate limit) never wait.
 */
@Injectable()
export class OperatorSettingsService implements OnModuleInit {
  private readonly logger = new Logger("OperatorSettings")
  private snapshot: OperatorOverrides = EMPTY
  private loadedAt = 0
  private loading: Promise<OperatorOverrides> | null = null

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly settings: SettingsService,
    private readonly encryption: EncryptionService,
  ) {}

  async onModuleInit() {
    await this.reload()
  }

  /** The saved values, from memory. Starts a reload in the background when they may be out of date. */
  current(): OperatorOverrides {
    if (Date.now() - this.loadedAt > OPERATOR_SETTINGS_TTL_MS) void this.reload().catch(() => undefined)
    return this.snapshot
  }

  /** The saved values, reloaded first when they may be out of date. */
  async get(): Promise<OperatorOverrides> {
    if (Date.now() - this.loadedAt > OPERATOR_SETTINGS_TTL_MS) return this.reload()
    return this.snapshot
  }

  async set(key: OperatorSettingKey, value: string | number): Promise<OperatorOverrides> {
    await this.settings.row()
    await this.db
      .update(settings)
      .set({ ...this.columnFor(key, value), operatorUpdatedAt: sql`now()` })
      .where(eq(settings.id, 1))
    return this.reload(true)
  }

  async clear(key: OperatorSettingKey): Promise<OperatorOverrides> {
    await this.settings.row()
    await this.db
      .update(settings)
      .set({ ...this.columnFor(key, null), operatorUpdatedAt: sql`now()` })
      .where(eq(settings.id, 1))
    return this.reload(true)
  }

  private columnFor(key: OperatorSettingKey, value: string | number | null) {
    switch (key) {
      case "billingPaystackSecretKey":
        return { billingPaystackSecretKeyEnc: value === null ? null : this.encryption.encrypt(String(value)) }
      case "smtpUrl":
        return { smtpUrlEnc: value === null ? null : this.encryption.encrypt(String(value)) }
      case "mailFrom":
        return { mailFrom: value === null ? null : String(value) }
      case "v1RateLimitPerMinute":
        return { v1RateLimitPerMinute: value === null ? null : Number(value) }
    }
  }

  /** Reads the row again. Concurrent callers share one read unless `force` asks for a fresh one. */
  private reload(force = false): Promise<OperatorOverrides> {
    if (this.loading && !force) return this.loading
    const run = this.read()
      .then((values) => {
        this.snapshot = values
        this.loadedAt = Date.now()
        return values
      })
      .finally(() => {
        if (this.loading === run) this.loading = null
      })
    this.loading = run
    return run
  }

  private async read(): Promise<OperatorOverrides> {
    const [row] = await this.db
      .select({
        billingPaystackSecretKeyEnc: settings.billingPaystackSecretKeyEnc,
        smtpUrlEnc: settings.smtpUrlEnc,
        mailFrom: settings.mailFrom,
        v1RateLimitPerMinute: settings.v1RateLimitPerMinute,
      })
      .from(settings)
      .where(eq(settings.id, 1))
    if (!row) return EMPTY
    return {
      billingPaystackSecretKey: this.open(row.billingPaystackSecretKeyEnc, "billing key"),
      smtpUrl: this.open(row.smtpUrlEnc, "SMTP URL"),
      mailFrom: row.mailFrom,
      v1RateLimitPerMinute: row.v1RateLimitPerMinute,
    }
  }

  /** A secret none of the configured keys can read is treated as not saved, so the env value applies. */
  private open(payload: string | null, what: string): string | null {
    if (!payload) return null
    try {
      return this.encryption.decrypt(payload)
    } catch {
      this.logger.warn(`The saved ${what} can't be read with the current encryption key; using the server's value instead.`)
      return null
    }
  }
}
