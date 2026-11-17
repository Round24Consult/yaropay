import { Inject, Injectable, type NestMiddleware } from "@nestjs/common"
import type { NextFunction, Request, Response } from "express"
import { APP_CONFIG, type AppConfig } from "../config/config.js"

const SAFE = new Set(["GET", "HEAD", "OPTIONS"])

/**
 * CSRF defence in depth for cookie-authenticated routes: state-changing
 * requests must come from the dashboard's origin (or carry no Origin, as
 * server-side clients do). The session cookie is also SameSite=Lax.
 */
@Injectable()
export class OriginMiddleware implements NestMiddleware {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  use(req: Request, res: Response, next: NextFunction) {
    const origin = req.get("origin")
    if (SAFE.has(req.method) || !origin) return next()
    const self = `${req.protocol}://${req.get("host")}`
    if (origin === self || this.config.corsOrigins.includes(origin)) return next()
    res.status(403).json({ error: { message: "Cross-site request refused", code: "bad_origin" } })
  }
}
