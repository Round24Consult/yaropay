import { Controller, Get, Inject, Req } from "@nestjs/common"
import type { Entitlements } from "@yaropay/core/editions"
import type { AuthedRequest } from "../auth/types.js"
import { ENTITLEMENTS, type EntitlementsSource } from "./extension.js"

@Controller("api/entitlements")
export class EntitlementsController {
  constructor(@Inject(ENTITLEMENTS) private readonly entitlements: EntitlementsSource) {}

  /** The edition, paid features and limits for the active workspace. Any member may read it. */
  @Get()
  get(@Req() req: AuthedRequest): Promise<Entitlements> {
    return this.entitlements.for(req.user.workspaceId)
  }
}
