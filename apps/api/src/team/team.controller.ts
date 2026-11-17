import { Controller, Delete, Get, Param, Patch, Post, Req } from "@nestjs/common"
import { inviteSchema, updateMemberSchema } from "@yaropay/core/auth"
import type { Request } from "express"
import type { z } from "zod"
import { CurrentUser, RequirePermissions } from "../auth/decorators.js"
import { type Actor, auditContext } from "../auth/types.js"
import { ZodBody } from "../common/zod.js"
import { TeamService } from "./team.service.js"

@Controller("api/team")
export class TeamController {
  constructor(private readonly team: TeamService) {}

  @Get()
  @RequirePermissions("team:read")
  members(@CurrentUser() user: Actor) {
    return this.team.members(user.workspaceId)
  }

  @Get("invites")
  @RequirePermissions("team:read")
  invites(@CurrentUser() user: Actor) {
    return this.team.invites(user.workspaceId)
  }

  @Post("invites")
  @RequirePermissions("team:write")
  invite(@CurrentUser() user: Actor, @Req() req: Request, @ZodBody(inviteSchema) body: z.infer<typeof inviteSchema>) {
    return this.team.invite(user, body, auditContext(user, req))
  }

  @Post("invites/:id/resend")
  @RequirePermissions("team:write")
  resend(@CurrentUser() user: Actor, @Req() req: Request, @Param("id") id: string) {
    return this.team.resend(user, id, auditContext(user, req))
  }

  @Delete("invites/:id")
  @RequirePermissions("team:write")
  async revoke(@CurrentUser() user: Actor, @Req() req: Request, @Param("id") id: string) {
    await this.team.revoke(user, id, auditContext(user, req))
    return { id }
  }

  @Patch(":id")
  @RequirePermissions("team:write")
  update(@CurrentUser() user: Actor, @Req() req: Request, @Param("id") id: string, @ZodBody(updateMemberSchema) body: z.infer<typeof updateMemberSchema>) {
    return this.team.update(user, id, body, auditContext(user, req))
  }

  @Delete(":id")
  @RequirePermissions("team:write")
  async remove(@CurrentUser() user: Actor, @Req() req: Request, @Param("id") id: string) {
    await this.team.remove(user, id, auditContext(user, req))
    return { id }
  }
}
