import { type CanActivate, type ExecutionContext, Inject, Injectable, SetMetadata } from "@nestjs/common"
import { Reflector } from "@nestjs/core"
import { type Feature, FEATURE_INFO } from "@yaropay/core/editions"
import type { AuthedRequest } from "../auth/types.js"
import { ApiException, unauthenticated } from "../common/errors.js"
import { EDITION, ENTITLEMENTS, type EntitlementsSource } from "./extension.js"

const FEATURE_KEY = "yaropay:feature"

/** Limits a route to workspaces whose edition or plan includes `feature`. */
export const RequireFeature = (feature: Feature) => SetMetadata(FEATURE_KEY, feature)

/** Runs after the permission check: answers 402 `feature_not_entitled` for a paid feature this workspace lacks. */
@Injectable()
export class FeatureGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(ENTITLEMENTS) private readonly entitlements: EntitlementsSource,
    @Inject(EDITION) private readonly edition: string,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const feature = this.reflector.getAllAndOverride<Feature | undefined>(FEATURE_KEY, [ctx.getHandler(), ctx.getClass()])
    if (!feature) return true
    const req = ctx.switchToHttp().getRequest<AuthedRequest>()
    if (!req.user) throw unauthenticated()
    const { features } = await this.entitlements.for(req.user.workspaceId)
    if (features.includes(feature)) return true
    const how = this.edition === "cloud" ? "Upgrade your plan to use it." : "It is available with YaroPay Enterprise."
    throw new ApiException(402, `${FEATURE_INFO[feature].label} isn't included. ${how}`, { code: "feature_not_entitled" })
  }
}
