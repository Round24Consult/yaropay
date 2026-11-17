import { Controller, Delete, Get, HttpCode, Param, Patch, Post, Req } from "@nestjs/common"
import type { ProductEvent } from "@yaropay/core/payments"
import { productInputSchema } from "@yaropay/core/schemas"
import type { Request } from "express"
import { z } from "zod"
import { CurrentUser, RequirePermissions } from "../auth/decorators.js"
import { assertProductVisible, scopeOf } from "../auth/scope.js"
import { type Actor, auditContext } from "../auth/types.js"
import { newId } from "../common/crypto.js"
import { forbidden, notFound } from "../common/errors.js"
import { ZodBody } from "../common/zod.js"
import { DeliveriesService } from "../webhooks/deliveries.service.js"
import { ProductsService } from "./products.service.js"

const patchSchema = productInputSchema.partial().extend({ status: z.enum(["active", "paused"]).optional() })
const rotateSchema = z.object({ which: z.enum(["apiKey", "testApiKey", "signingSecret"]) })
const testSchema = z.object({ mode: z.enum(["test", "live"]).default("test") })

@Controller("api/products")
export class ProductsController {
  constructor(
    private readonly products: ProductsService,
    private readonly deliveries: DeliveriesService,
  ) {}

  @Get()
  @RequirePermissions("products:read")
  list(@CurrentUser() user: Actor) {
    return this.products.listWithStats(scopeOf(user))
  }

  @Post()
  @RequirePermissions("products:write")
  create(@CurrentUser() user: Actor, @Req() req: Request, @ZodBody(productInputSchema) body: z.infer<typeof productInputSchema>) {
    if (user.productIds !== null) throw forbidden("Members limited to some products can't create new ones")
    return this.products.create(body, auditContext(user, req))
  }

  @Get(":id")
  @RequirePermissions("products:read")
  async get(@CurrentUser() user: Actor, @Param("id") id: string) {
    const product = await this.products.getWithStats(user.workspaceId, id)
    if (!product) throw notFound("Product")
    assertProductVisible(user, product.id)
    return product
  }

  @Patch(":id")
  @RequirePermissions("products:write")
  update(@CurrentUser() user: Actor, @Req() req: Request, @Param("id") id: string, @ZodBody(patchSchema) body: z.infer<typeof patchSchema>) {
    assertProductVisible(user, id)
    return this.products.update(id, body, auditContext(user, req))
  }

  @Delete(":id")
  @RequirePermissions("products:delete")
  async remove(@CurrentUser() user: Actor, @Req() req: Request, @Param("id") id: string) {
    assertProductVisible(user, id)
    await this.products.remove(id, auditContext(user, req))
    return { id }
  }

  @Post(":id/rotate")
  @HttpCode(200)
  @RequirePermissions("products:keys")
  rotate(@CurrentUser() user: Actor, @Req() req: Request, @Param("id") id: string, @ZodBody(rotateSchema) body: z.infer<typeof rotateSchema>) {
    assertProductVisible(user, id)
    return this.products.rotate(id, body.which, auditContext(user, req))
  }

  /** Sends a signed `test.ping` to the product's webhook endpoint and returns the result. */
  @Post(":id/test-webhook")
  @HttpCode(200)
  @RequirePermissions("products:write")
  async testWebhook(@CurrentUser() user: Actor, @Param("id") id: string, @ZodBody(testSchema) body: z.infer<typeof testSchema>) {
    assertProductVisible(user, id)
    const product = await this.products.rowIn(user.workspaceId, id)
    if (!product) throw notFound("Product")
    const now = new Date().toISOString()
    const event: ProductEvent = {
      id: newId("pev"),
      type: "test.ping",
      mode: body.mode,
      createdAt: now,
      data: {
        id: "txn_test",
        reference: `${product.referencePrefix}_TEST000000`,
        productId: product.id,
        gateway: "paystack",
        amount: 100_00,
        fee: 0,
        currency: "NGN",
        status: "success",
        channel: "card",
        customer: { email: "customer@example.com", name: "Test Customer" },
        metadata: { test: true, sentBy: user.name },
        paidAt: now,
      },
    }
    const row = await this.deliveries.enqueue({ product, event, transactionId: null, eventId: null })
    return this.deliveries.sendNow(row.id, true)
  }
}
