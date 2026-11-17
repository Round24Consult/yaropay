import { Controller, Get, Param, Query, Res } from "@nestjs/common"
import type { PeriodPreset } from "@yaropay/core/analytics"
import type { Response } from "express"
import { CurrentUser, RequirePermissions } from "../auth/decorators.js"
import { assertProductVisible, scopeOf } from "../auth/scope.js"
import type { Actor } from "../auth/types.js"
import { notFound } from "../common/errors.js"
import { int, list, modeOf, type Query as Q, str } from "../common/query.js"
import { type TransactionQuery, TransactionsService } from "./transactions.service.js"

const PRESETS = new Set(["today", "7d", "30d", "90d", "ytd", "12m", "custom"])

function parse(user: Actor, q: Q, pageSizeMax = 200): TransactionQuery {
  const period = str(q, "period")
  return {
    mode: modeOf(q),
    search: (str(q, "q") ?? "").trim().slice(0, 100),
    currency: str(q, "currency") ?? null,
    period: period && PRESETS.has(period) ? (period as PeriodPreset) : null,
    from: str(q, "from"),
    to: str(q, "to"),
    scope: scopeOf(user),
    products: list(q, "product"),
    gateways: list(q, "gateway"),
    statuses: list(q, "status"),
    channels: list(q, "channel"),
    sort: str(q, "sort") ?? "-createdAt",
    page: int(q, "page", 1),
    pageSize: int(q, "pageSize", 25, pageSizeMax),
  }
}

@Controller("api/transactions")
export class TransactionsController {
  constructor(private readonly transactions: TransactionsService) {}

  @Get()
  @RequirePermissions("transactions:read")
  list(@CurrentUser() user: Actor, @Query() q: Q) {
    return this.transactions.list(parse(user, q))
  }

  @Get("export.csv")
  @RequirePermissions("transactions:export")
  async export(@CurrentUser() user: Actor, @Query() q: Q, @Res() res: Response) {
    const query = parse(user, q)
    res.setHeader("content-type", "text/csv; charset=utf-8")
    res.setHeader("content-disposition", `attachment; filename="yaropay-${query.mode}-transactions-${new Date().toISOString().slice(0, 10)}.csv"`)
    res.setHeader("cache-control", "no-store")
    for await (const chunk of this.transactions.csv(query)) {
      if (!res.write(chunk)) await new Promise((r) => res.once("drain", r))
    }
    res.end()
  }

  @Get(":id")
  @RequirePermissions("transactions:read")
  async detail(@CurrentUser() user: Actor, @Param("id") id: string) {
    const row = await this.transactions.findRow(user.workspaceId, id)
    if (!row) throw notFound("Transaction")
    try {
      assertProductVisible(user, row.productId)
    } catch {
      throw notFound("Transaction")
    }
    return this.transactions.detail(row)
  }
}
