import { Controller, Get, Inject } from "@nestjs/common"
import { SkipThrottle } from "@nestjs/throttler"
import { sql } from "drizzle-orm"
import { Public } from "../auth/decorators.js"
import { DB_HANDLE } from "../database/database.module.js"
import type { DatabaseHandle } from "../database/db.js"

@Public()
@SkipThrottle()
@Controller("health")
export class HealthController {
  constructor(@Inject(DB_HANDLE) private readonly db: DatabaseHandle) {}

  @Get()
  async health() {
    await this.db.db.execute(sql`select 1`)
    return { status: "ok", database: this.db.kind, time: new Date().toISOString() }
  }
}
