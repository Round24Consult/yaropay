import { Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Req } from "@nestjs/common"
import { Throttle } from "@nestjs/throttler"
import { connectionInputSchema } from "@yaropay/core/gateways/credentials"
import type { Request } from "express"
import { z } from "zod"
import { CurrentUser, RequirePermissions } from "../auth/decorators.js"
import { type Actor, auditContext } from "../auth/types.js"
import { type Query as Q, str } from "../common/query.js"
import { ZodBody } from "../common/zod.js"
import { ConnectionsService } from "./connections.service.js"

const patchSchema = z.object({
  label: z.string().trim().min(2).max(48).optional(),
  credentials: z.record(z.string(), z.string()).optional(),
})

const testSchema = z.object({
  gatewayId: z.string(),
  mode: z.enum(["test", "live"]),
  credentials: z.record(z.string(), z.string()),
})

@Controller("api")
export class GatewaysController {
  constructor(private readonly connections: ConnectionsService) {}

  @Get("gateways")
  @RequirePermissions("gateways:read")
  gateways(@CurrentUser() user: Actor) {
    return this.connections.gateways(user.workspaceId)
  }

  @Get("connections")
  @RequirePermissions("gateways:read")
  list(@CurrentUser() user: Actor) {
    return this.connections.list(user.workspaceId)
  }

  @Post("connections")
  @RequirePermissions("gateways:write")
  install(@CurrentUser() user: Actor, @Req() req: Request, @ZodBody(connectionInputSchema) body: z.infer<typeof connectionInputSchema>) {
    return this.connections.install(body, auditContext(user, req))
  }

  @Post("connections/test")
  @HttpCode(200)
  @RequirePermissions("gateways:write")
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  test(@ZodBody(testSchema) body: z.infer<typeof testSchema>) {
    return this.connections.test(body)
  }

  @Get("connections/:id")
  @RequirePermissions("gateways:read")
  detail(@CurrentUser() user: Actor, @Param("id") id: string) {
    return this.connections.detail(user.workspaceId, id)
  }

  @Patch("connections/:id")
  @RequirePermissions("gateways:write")
  update(@CurrentUser() user: Actor, @Req() req: Request, @Param("id") id: string, @ZodBody(patchSchema) body: z.infer<typeof patchSchema>) {
    return this.connections.update(id, body, auditContext(user, req))
  }

  @Delete("connections/:id")
  @RequirePermissions("gateways:write")
  async remove(@CurrentUser() user: Actor, @Req() req: Request, @Param("id") id: string, @Query() q: Q) {
    await this.connections.remove(id, str(q, "force") === "1", auditContext(user, req))
    return { id }
  }
}
