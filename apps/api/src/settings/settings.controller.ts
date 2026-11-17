import { Controller, Get, HttpCode, Patch, Post, Req } from "@nestjs/common"
import { settingsSchema } from "@yaropay/core/schemas"
import type { PlatformSettings } from "@yaropay/core/types"
import type { Request } from "express"
import { AuditService } from "../audit/audit.service.js"
import { CurrentUser, RequirePermissions } from "../auth/decorators.js"
import { type Actor, auditContext } from "../auth/types.js"
import { ZodBody } from "../common/zod.js"
import { AlertsService } from "../notifications/alerts.service.js"
import { SettingsService } from "./settings.service.js"

@Controller("api/settings")
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly alerts: AlertsService,
  ) {}

  @Get()
  @RequirePermissions("settings:read")
  get(@CurrentUser() user: Actor) {
    return this.settings.get(user.workspaceId)
  }

  @Patch()
  @RequirePermissions("settings:write")
  async update(@CurrentUser() user: Actor, @Req() req: Request, @ZodBody(settingsSchema.partial()) body: Partial<PlatformSettings>) {
    const next = await this.settings.update(user.workspaceId, body)
    const changed = Object.keys(body).join(", ") || "nothing"
    await this.audit.record(auditContext(user, req), "Updated settings", changed)
    return next
  }

  @Post("alerts/test")
  @HttpCode(200)
  @RequirePermissions("settings:write")
  async testAlert(@CurrentUser() user: Actor) {
    const url = await this.settings.alertsWebhookUrl(user.workspaceId)
    if (!url) return { ok: false, message: "Save an alerts webhook URL first." }
    const s = await this.settings.install()
    try {
      await this.alerts.post(`:white_check_mark: Test alert from ${s.platformName}, sent by ${user.name}. Alerts are working.`, url)
      return { ok: true, message: "Test alert sent." }
    } catch (e) {
      return { ok: false, message: (e as Error).message }
    }
  }
}
