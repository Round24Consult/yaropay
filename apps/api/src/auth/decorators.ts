import { createParamDecorator, type ExecutionContext, SetMetadata } from "@nestjs/common"
import type { Permission } from "@yaropay/core/auth"
import type { AuthedRequest } from "./types.js"

export const IS_PUBLIC = "yaropay:public"
export const PERMISSIONS_KEY = "yaropay:permissions"
export const ALLOW_PENDING = "yaropay:allow-pending"
export const ALLOW_IN_SUPPORT = "yaropay:allow-in-support"

/** Skips the session guard (public pages, gateway webhooks, product API). */
export const Public = () => SetMetadata(IS_PUBLIC, true)

/** Reachable by a session still waiting for its authenticator code (the code step, signing out). */
export const AllowPending = () => SetMetadata(ALLOW_PENDING, true)

/** A change a read-only support view may still make (signing out, ending the view). */
export const AllowInSupport = () => SetMetadata(ALLOW_IN_SUPPORT, true)

/** Every listed permission is required. */
export const RequirePermissions = (...permissions: Permission[]) => SetMetadata(PERMISSIONS_KEY, permissions)

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest<AuthedRequest>().user
})

export const CurrentSession = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest<AuthedRequest>().session
})
