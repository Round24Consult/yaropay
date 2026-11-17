import type { INestApplication } from "@nestjs/common"
import { NestFactory } from "@nestjs/core"
import type { NestExpressApplication } from "@nestjs/platform-express"
import cookieParser from "cookie-parser"
import helmet from "helmet"
import { AppModule } from "./app.module.js"
import type { AppConfig } from "./config/config.js"
import type { Extension } from "./extension/extension.js"

const LEVELS = ["error", "warn", "log", "debug", "verbose"] as const

/** Builds the HTTP app. Shared by main.ts and the tests. */
export async function createApp(config: AppConfig, opts: { logger?: false; extension?: Extension } = {}): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config, opts.extension), {
    rawBody: true,
    // Open notification streams (SSE) would otherwise hold shutdown, and restarts, forever.
    forceCloseConnections: true,
    logger: opts.logger === false ? false : LEVELS.slice(0, LEVELS.indexOf(config.logLevel) + 1),
  })
  return configureApp(app, config)
}

/** Express settings and middleware shared by the server and the tests. */
export function configureApp(app: NestExpressApplication, config: AppConfig): NestExpressApplication {
  app.set("trust proxy", config.trustProxy)
  app.disable("x-powered-by")
  app.use(helmet({ crossOriginResourcePolicy: { policy: "same-site" } }))
  app.use(cookieParser())
  app.enableCors({ origin: config.corsOrigins, credentials: true })
  app.enableShutdownHooks()
  return app
}
