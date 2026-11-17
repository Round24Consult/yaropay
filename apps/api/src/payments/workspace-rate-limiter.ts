import { Inject, Injectable } from "@nestjs/common"
import { APP_CONFIG, type AppConfig } from "../config/config.js"

const WINDOW_MS = 60_000

/**
 * A per-company budget for the product API, on top of the per-address limit: one company's runaway
 * script slows down only that company. Counted per minute in this process.
 */
@Injectable()
export class WorkspaceRateLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>()
  private readonly limit: number | null

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.limit = config.rateLimit ? config.v1RateLimitPerMinute : null
  }

  /** Counts one request. Returns the seconds to wait when the company is over its budget. */
  take(workspaceId: string, now = Date.now()): { ok: true } | { ok: false; retryAfter: number } {
    if (this.limit === null) return { ok: true }
    let w = this.windows.get(workspaceId)
    if (!w || now - w.start >= WINDOW_MS) {
      w = { start: now, count: 0 }
      this.windows.set(workspaceId, w)
      if (this.windows.size > 10_000) this.sweep(now)
    }
    w.count++
    if (w.count <= this.limit) return { ok: true }
    return { ok: false, retryAfter: Math.max(1, Math.ceil((w.start + WINDOW_MS - now) / 1000)) }
  }

  private sweep(now: number) {
    for (const [id, w] of this.windows) if (now - w.start >= WINDOW_MS) this.windows.delete(id)
  }
}
