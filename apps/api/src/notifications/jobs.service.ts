import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from "@nestjs/common"
import { and, asc, eq, isNull, lte, or, sql } from "drizzle-orm"
import { newId } from "../common/crypto.js"
import { APP_CONFIG, type AppConfig } from "../config/config.js"
import { DB } from "../database/database.module.js"
import type { Db, DbOrTx } from "../database/db.js"
import { type JobRow, jobs } from "../database/schema.js"

type Handler = (payload: Record<string, unknown>) => Promise<void>

const BACKOFF_MS = [30_000, 120_000, 600_000, 1_800_000, 3_600_000]

/**
 * A small Postgres-backed outbox for emails and alert posts. Rows are claimed
 * with FOR UPDATE SKIP LOCKED, so several API instances can share the work.
 */
@Injectable()
export class JobsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger("Jobs")
  private readonly handlers = new Map<string, Handler>()
  private timer: NodeJS.Timeout | null = null
  private running = false

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  register(kind: string, handler: Handler) {
    this.handlers.set(kind, handler)
  }

  async enqueue(kind: string, payload: Record<string, unknown>, opts: { runAt?: Date; maxAttempts?: number } = {}, tx: DbOrTx = this.db) {
    await tx.insert(jobs).values({
      id: newId("job"),
      kind,
      payload,
      runAt: opts.runAt ?? new Date(),
      maxAttempts: opts.maxAttempts ?? 5,
    })
  }

  onApplicationBootstrap() {
    if (!this.config.workers) return
    this.timer = setInterval(() => void this.tick(), this.config.workerIntervalMs)
    this.timer.unref()
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer)
  }

  private async tick() {
    if (this.running) return
    this.running = true
    try {
      await this.runDue()
    } catch (e) {
      this.logger.error(`Job tick failed: ${(e as Error).message}`)
    } finally {
      this.running = false
    }
  }

  /** Runs every due job once. Returns how many ran. Tests call this directly. */
  async runDue(limit = 20): Promise<number> {
    const now = new Date()
    const claimed: JobRow[] = await this.db.transaction(async (tx) => {
      const due = await tx
        .select()
        .from(jobs)
        .where(and(isNull(jobs.doneAt), lte(jobs.runAt, now), or(isNull(jobs.lockedUntil), lte(jobs.lockedUntil, now))))
        .orderBy(asc(jobs.runAt))
        .limit(limit)
        .for("update", { skipLocked: true })
      for (const j of due) {
        await tx.update(jobs).set({ lockedUntil: new Date(now.getTime() + 60_000), attempts: sql`${jobs.attempts} + 1` }).where(eq(jobs.id, j.id))
      }
      return due
    })
    for (const job of claimed) await this.run(job)
    return claimed.length
  }

  private async run(job: JobRow) {
    const handler = this.handlers.get(job.kind)
    const attempts = job.attempts + 1
    try {
      if (!handler) throw new Error(`No handler for job kind ${job.kind}`)
      await handler(job.payload)
      await this.db.update(jobs).set({ doneAt: new Date(), lockedUntil: null, lastError: null }).where(eq(jobs.id, job.id))
    } catch (e) {
      const message = (e as Error).message.slice(0, 500)
      const done = attempts >= job.maxAttempts
      this.logger.warn(`Job ${job.kind} ${job.id} failed (attempt ${attempts}/${job.maxAttempts}): ${message}`)
      await this.db
        .update(jobs)
        .set({
          lastError: message,
          lockedUntil: null,
          doneAt: done ? new Date() : null,
          runAt: new Date(Date.now() + BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)]),
        })
        .where(eq(jobs.id, job.id))
    }
  }
}
