import { Controller, Delete, Get, HttpCode, Post, Req } from "@nestjs/common"
import { Throttle } from "@nestjs/throttler"
import type { Request } from "express"
import { CurrentUser, RequirePermissions } from "../auth/decorators.js"
import { type Actor, auditContext } from "../auth/types.js"
import { OnboardingService } from "./onboarding.service.js"

@Controller("api")
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Get("onboarding")
  @RequirePermissions("dashboard:read")
  status(@CurrentUser() user: Actor) {
    return this.onboarding.status(user)
  }

  @Post("onboarding/dismiss")
  @HttpCode(204)
  @RequirePermissions("dashboard:read")
  async dismiss(@CurrentUser() user: Actor) {
    await this.onboarding.setDismissed(user, true)
  }

  @Post("onboarding/restore")
  @HttpCode(204)
  @RequirePermissions("dashboard:read")
  async restore(@CurrentUser() user: Actor) {
    await this.onboarding.setDismissed(user, false)
  }

  @Post("sample-data")
  @RequirePermissions("settings:write")
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async loadSample(@CurrentUser() user: Actor, @Req() req: Request) {
    await this.onboarding.loadSample(auditContext(user, req))
    return this.onboarding.status(user)
  }

  @Delete("sample-data")
  @RequirePermissions("settings:write")
  removeSample(@CurrentUser() user: Actor, @Req() req: Request) {
    return this.onboarding.removeSample(auditContext(user, req))
  }
}
