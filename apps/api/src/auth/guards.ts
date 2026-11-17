import { type CanActivate, type ExecutionContext, Injectable } from "@nestjs/common"
import { Reflector } from "@nestjs/core"
import type { Permission } from "@yaropay/core/auth"
import { ApiException, forbidden, unauthenticated } from "../common/errors.js"
import { AuthService, SESSION_COOKIE } from "./auth.service.js"
import { ALLOW_IN_SUPPORT, ALLOW_PENDING, IS_PUBLIC, PERMISSIONS_KEY } from "./decorators.js"
import type { AuthedRequest } from "./types.js"

/** Every route needs a valid session cookie unless it is marked @Public(). */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== "http") return true
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()])
    if (isPublic) return true
    const req = ctx.switchToHttp().getRequest<AuthedRequest>()
    const token = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE]
    if (!token) throw unauthenticated()
    const result = await this.auth.authenticate(token)
    if (!result) throw unauthenticated("Your session has ended. Sign in again.")
    if (result.session.assurance === "pending") {
      const allowed = this.reflector.getAllAndOverride<boolean>(ALLOW_PENDING, [ctx.getHandler(), ctx.getClass()])
      if (!allowed) throw new ApiException(401, "Enter the code from your authenticator app to finish signing in.", { code: "mfa_required" })
    }
    // The dashboard says which workspace it is showing. If another tab switched this session since,
    // refuse instead of acting on a different company than the one on screen.
    const shown = req.get("x-workspace-id")
    if (shown && shown !== result.actor.workspaceId) {
      throw new ApiException(409, "You switched workspace in another tab. Reload to continue.", { code: "workspace_changed" })
    }
    // A support view looks, never touches: every change is refused, on every route.
    if (result.session.readOnly && !["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      const allowed = this.reflector.getAllAndOverride<boolean>(ALLOW_IN_SUPPORT, [ctx.getHandler(), ctx.getClass()])
      if (!allowed) throw new ApiException(403, "This is a read-only support view. End it to make changes in your own company.", { code: "support_read_only" })
    }
    req.user = result.actor
    req.session = result.session
    return true
  }
}

/** Checks @RequirePermissions() against the member's resolved permissions. */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission[] | undefined>(PERMISSIONS_KEY, [ctx.getHandler(), ctx.getClass()])
    if (!required?.length) return true
    const req = ctx.switchToHttp().getRequest<AuthedRequest>()
    if (!req.user) throw unauthenticated()
    const missing = required.filter((p) => !req.user.permissions.includes(p))
    if (missing.length) throw forbidden(`Your role (${req.user.role}) can't do this. Ask an admin for access.`)
    return true
  }
}
