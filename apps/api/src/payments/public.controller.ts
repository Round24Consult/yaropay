import { Controller, Get, Headers, Param, Post, Query, Req, Res, UseGuards, type RawBodyRequest } from "@nestjs/common"
import { SkipThrottle } from "@nestjs/throttler"
import { createPaymentSchema } from "@yaropay/core/payments"
import { gatewayRegistry } from "@yaropay/core/gateways/registry"
import type { Request, Response } from "express"
import type { z } from "zod"
import { Public } from "../auth/decorators.js"
import { badRequest } from "../common/errors.js"
import { type Query as Q, str } from "../common/query.js"
import { ZodBody } from "../common/zod.js"
import { SettingsService } from "../settings/settings.service.js"
import { ApiKeyGuard, type ProductRequest } from "./api-key.guard.js"
import { type CallbackOutcome, PaymentsService } from "./payments.service.js"

const GATEWAY_IDS = new Set(gatewayRegistry.map((g) => g.id as string))
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

/** Product servers create and look up payments with their API key. */
@Public()
@Controller("v1/products/:productId/payments")
@UseGuards(ApiKeyGuard)
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post()
  async create(
    @Req() req: ProductRequest,
    @Res({ passthrough: true }) res: Response,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @ZodBody(createPaymentSchema) body: z.infer<typeof createPaymentSchema>,
  ) {
    const key = idempotencyKey?.trim()
    if (key && key.length > 200) throw badRequest("Idempotency-Key must be at most 200 characters")
    const { created, payment } = await this.payments.create(req.product, req.apiMode, body, key || null)
    res.status(created ? 201 : 200)
    return payment
  }

  @Get(":reference")
  get(@Req() req: ProductRequest, @Param("reference") reference: string, @Query() q: Q) {
    return this.payments.get(req.product, req.apiMode, reference, str(q, "refresh") === "1" || str(q, "refresh") === "true")
  }
}

/** Customers come back here from the gateway checkout. */
@Public()
@SkipThrottle()
@Controller("v1/callback")
export class CallbackController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly settings: SettingsService,
  ) {}

  @Get(":a/:b")
  async callback(@Param("a") a: string, @Param("b") b: string, @Query() q: Q, @Res() res: Response) {
    const query = Object.fromEntries(Object.entries(q).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]))
    // `/v1/callback/{gateway}/{connectionId}` is the gateway-dashboard fallback; otherwise `/{productId}/{gateway}`.
    const outcome: CallbackOutcome = GATEWAY_IDS.has(a)
      ? await this.payments.connectionCallback(a, b, query)
      : await this.payments.productCallback(a, b, query)
    if (outcome.kind === "redirect") {
      res.redirect(303, outcome.url)
      return
    }
    const s = await this.settings.install()
    res
      .status(outcome.status)
      .type("html")
      .send(
        `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(outcome.title)}</title>` +
          `<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f6f8;font-family:system-ui,sans-serif;color:#18181b}main{max-width:420px;margin:16px;background:#fff;border:1px solid #e4e4e7;border-radius:16px;padding:28px}h1{font-size:20px;margin:0 0 8px}p{color:#52525b;line-height:1.5;margin:0}small{display:block;margin-top:16px;color:#a1a1aa}@media(prefers-color-scheme:dark){body{background:#09090b;color:#fafafa}main{background:#18181b;border-color:#27272a}p{color:#a1a1aa}}</style></head>` +
          `<body><main><h1>${esc(outcome.title)}</h1><p>${esc(outcome.message)}</p><small>${esc(s.platformName)}</small></main></body></html>`,
      )
  }
}

/** Gateways post events here. One URL per installed gateway account. */
@Public()
@SkipThrottle()
@Controller("v1/webhooks")
export class GatewayWebhookController {
  constructor(private readonly payments: PaymentsService) {}

  @Post(":gateway/:connectionId")
  async receive(@Param("gateway") gateway: string, @Param("connectionId") connectionId: string, @Req() req: RawBodyRequest<Request>, @Res() res: Response) {
    const result = await this.payments.ingest(gateway, connectionId, req.rawBody, req.headers, req.ip ?? null)
    res.status(result.status).json(result.body)
  }
}
