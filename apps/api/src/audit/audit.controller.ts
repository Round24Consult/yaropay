import { Controller, Get, Query } from "@nestjs/common"
import { CurrentUser, RequirePermissions } from "../auth/decorators.js"
import type { Actor } from "../auth/types.js"
import { int, type Query as Q } from "../common/query.js"
import { AuditService } from "./audit.service.js"

@Controller("api/audit")
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequirePermissions("audit:read")
  list(@CurrentUser() user: Actor, @Query() q: Q) {
    return this.audit.list(user.workspaceId, int(q, "limit", 100, 500))
  }
}
