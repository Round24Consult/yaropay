import { Controller, Get, HttpCode, Param, Post, Query, Req } from "@nestjs/common"
import type { Request } from "express"
import { AuditService } from "../audit/audit.service.js"
import { CurrentUser, RequirePermissions } from "../auth/decorators.js"
import { assertProductVisible, scopeOf } from "../auth/scope.js"
import { type Actor, auditContext } from "../auth/types.js"
import { notFound } from "../common/errors.js"
import { int, list, modeOf, type Query as Q, str } from "../common/query.js"
import { DeliveriesService } from "./deliveries.service.js"
import { EventsService } from "./events.service.js"

@Controller("api/webhooks")
export class WebhooksController {
  constructor(
    private readonly events: EventsService,
    private readonly deliveries: DeliveriesService,
    private readonly audit: AuditService,
  ) {}

  @Get("events")
  @RequirePermissions("webhooks:read")
  listEvents(@CurrentUser() user: Actor, @Query() q: Q) {
    const routing = str(q, "routing")
    return this.events.list({
      mode: modeOf(q),
      routing: routing === "routed" || routing === "unrouted" ? routing : null,
      scope: scopeOf(user, list(q, "product")),
      scoped: user.productIds !== null,
      gateways: list(q, "gateway"),
      search: (str(q, "q") ?? "").trim().slice(0, 100),
      page: int(q, "page", 1),
      pageSize: int(q, "pageSize", 25, 100),
    })
  }

  @Get("deliveries")
  @RequirePermissions("webhooks:read")
  listDeliveries(@CurrentUser() user: Actor, @Query() q: Q) {
    return this.deliveries.list({
      mode: modeOf(q),
      states: list(q, "state"),
      scope: scopeOf(user, list(q, "product")),
      sinceDays: Number(str(q, "sinceDays") ?? 0) || 0,
      page: int(q, "page", 1),
      pageSize: int(q, "pageSize", 25, 100),
    })
  }

  @Post("deliveries/:id/replay")
  @HttpCode(200)
  @RequirePermissions("webhooks:replay")
  async replay(@CurrentUser() user: Actor, @Req() req: Request, @Param("id") id: string) {
    const row = await this.deliveries.find(user.workspaceId, id)
    if (!row) throw notFound("Delivery")
    assertProductVisible(user, row.productId)
    const result = await this.deliveries.sendNow(id, true)
    await this.audit.record(auditContext(user, req), "Replayed delivery", `${row.eventType} to ${row.url}: ${result.state}`)
    return result
  }
}
