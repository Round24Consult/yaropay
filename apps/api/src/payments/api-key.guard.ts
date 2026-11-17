import { type CanActivate, type ExecutionContext, Injectable } from "@nestjs/common"
import { modeOfApiKey } from "@yaropay/core/payments"
import type { Mode } from "@yaropay/core/types"
import type { Request } from "express"
import { ApiException } from "../common/errors.js"
import type { ProductRow } from "../database/schema.js"
import { ProductsService } from "../products/products.service.js"
import { WorkspaceRateLimiter } from "./workspace-rate-limiter.js"

export interface ProductRequest extends Request {
  product: ProductRow
  apiMode: Mode
}

/** `Authorization: Bearer ypk_live_...` or `ypk_test_...`. The key must belong to the product in the URL. */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly products: ProductsService,
    private readonly limiter: WorkspaceRateLimiter,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<ProductRequest>()
    const header = req.get("authorization") ?? ""
    const key = header.startsWith("Bearer ") ? header.slice(7).trim() : ""
    if (!key || !modeOfApiKey(key)) {
      throw new ApiException(401, "Send your product API key as Authorization: Bearer ypk_live_... or ypk_test_...", { code: "invalid_api_key" })
    }
    const found = await this.products.findByApiKey(key)
    if (!found || found.product.id !== req.params.productId) {
      throw new ApiException(401, "This API key is not valid for this product", { code: "invalid_api_key" })
    }
    const budget = this.limiter.take(found.product.workspaceId)
    if (!budget.ok) {
      req.res?.setHeader("Retry-After", String(budget.retryAfter))
      throw new ApiException(429, `Too many requests for this company. Try again in ${budget.retryAfter} seconds.`, { code: "rate_limited" })
    }
    req.product = found.product
    req.apiMode = found.mode
    return true
  }
}
