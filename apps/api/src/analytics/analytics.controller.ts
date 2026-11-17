import { Controller, Get, Query } from "@nestjs/common"
import { isCurrencyCode } from "@yaropay/core/currencies"
import { defaultGranularity, type Granularity, type OverviewQuery, type PeriodPreset, resolvePeriod } from "@yaropay/core/analytics"
import type { CurrencyCode, GatewayId } from "@yaropay/core/types"
import { CurrentUser, RequirePermissions } from "../auth/decorators.js"
import { scopeOf } from "../auth/scope.js"
import type { Actor } from "../auth/types.js"
import { list, modeOf, type Query as Q, str } from "../common/query.js"
import { SettingsService } from "../settings/settings.service.js"
import { AnalyticsService } from "./analytics.service.js"

const GRANULARITIES = new Set(["day", "week", "month"])
const PRESETS = new Set(["today", "7d", "30d", "90d", "ytd", "12m", "custom"])

@Controller("api/analytics")
export class AnalyticsController {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly settings: SettingsService,
  ) {}

  @Get("overview")
  @RequirePermissions("dashboard:read")
  async overview(@CurrentUser() user: Actor, @Query() q: Q) {
    const period = str(q, "period") ?? "30d"
    const preset = (PRESETS.has(period) ? period : "30d") as PeriodPreset
    const range = resolvePeriod(preset, new Date(), { from: str(q, "from"), to: str(q, "to") })
    const g = str(q, "granularity")
    const currency = str(q, "currency") ?? (await this.settings.get(user.workspaceId)).defaultCurrency
    const query: OverviewQuery = {
      ...range,
      products: list(q, "product"),
      gateways: list(q, "gateway") as GatewayId[],
      currency: isCurrencyCode(currency) ? currency : "NGN",
      granularity: (g && GRANULARITIES.has(g) ? g : defaultGranularity(range.from, range.to)) as Granularity,
      mode: modeOf(q),
    }
    return this.analytics.overview(query, { scope: scopeOf(user) })
  }
}
