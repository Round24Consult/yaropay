import { Inject, Injectable } from "@nestjs/common"
import { APP_CONFIG, type AppConfig } from "../config/config.js"
import { OperatorSettingsService } from "../settings/operator-settings.service.js"

const WINDOW_MS = 60_000

/**
 * A per-company budget for the product API, on top of the per-address limit: one company's runaway
 * script slows down only that company. Counted per minute in this process. The limit is the one saved in
 * the platform console, otherwise V1_RATE_LIMIT_PER_MINUTE; RATE_LIMIT=off turns it off either way.
 */
@Injectable()
export class WorkspaceRateLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>()

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly operator: OperatorSettingsService,
  ) {}

  private get limit(): number | null {
    if (!this.config.rateLimit) return null
    return this.operator.current().v1RateLimitPerMinute ?? this.config.v1RateLimitPerMinute
  }

  /** Counts one request. Returns the seconds to wait when the company is over its budget. */
  take(workspaceId: string, now = Date.now()): { ok: true } | { ok: false; retryAfter: number } {
    const limit = this.limit
    if (limit === null) return { ok: true }
    let w = this.windows.get(workspaceId)
    if (!w || now - w.start >= WINDOW_MS) {
      w = { start: now, count: 0 }
      this.windows.set(workspaceId, w)
      if (this.windows.size > 10_000) this.sweep(now)
    }
    w.count++
    if (w.count <= limit) return { ok: true }
    return { ok: false, retryAfter: Math.max(1, Math.ceil((w.start + WINDOW_MS - now) / 1000)) }
  }

  private sweep(now: number) {
    for (const [id, w] of this.windows) if (now - w.start >= WINDOW_MS) this.windows.delete(id)
  }
}
