import { readFileSync } from "node:fs"
import { Test } from "@nestjs/testing"
import { sql } from "drizzle-orm"
import type { NestExpressApplication } from "@nestjs/platform-express"
import supertest from "supertest"
import { AppModule } from "../src/app.module.js"
import { configureApp } from "../src/bootstrap.js"
import type { Extension } from "../src/extension/extension.js"
import { FETCH } from "../src/common/http.js"
import { loadConfig } from "../src/config/config.js"
import { DB } from "../src/database/database.module.js"
import type { Db } from "../src/database/db.js"
import { JobsService } from "../src/notifications/jobs.service.js"
import { MailerService } from "../src/notifications/mailer.service.js"
import { DeliveriesService } from "../src/webhooks/deliveries.service.js"
import { FakeNetwork } from "./fake-network.js"

export const OWNER = { name: "Ada Owner", email: "owner@example.test", password: "correct-horse-battery", companyName: "Company A" }
export const DASHBOARD = "http://dash.test"

/** Set TEST_DATABASE_URL to run the suite against real Postgres (files run one at a time; tables are emptied per app). */
const PG_URL = process.env.TEST_DATABASE_URL

/** `extension`: a paid build's extension, for its tests. Core tests run as Community. */
export async function createTestApp(env: Record<string, string> = {}, opts: { extension?: Extension } = {}) {
  const config = loadConfig({
    NODE_ENV: "test",
    PGLITE_DIR: "memory://",
    ...(PG_URL ? { DATABASE_URL: PG_URL } : {}),
    PASSWORD_HASH_COST: "fast",
    WORKERS: "off",
    RATE_LIMIT: "off",
    WEBHOOK_ALLOW_PRIVATE: "true",
    DASHBOARD_URL: DASHBOARD,
    YAROPAY_BASE_URL: "https://pay.example.test",
    PAYSTACK_API_URL: "https://api.paystack.test",
    FLUTTERWAVE_API_URL: "https://api.flutterwave.test",
    PAYPAL_API_URL: "https://api.paypal.test",
    LOG_LEVEL: "error",
    ...env,
  })
  const net = new FakeNetwork()
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(config, opts.extension)] })
    .overrideProvider(FETCH)
    .useValue(net.fetch)
    .compile()
  const app = moduleRef.createNestApplication<NestExpressApplication>({ rawBody: true, logger: false })
  configureApp(app, config)
  await app.init()
  if (PG_URL) {
    await app.get<Db>(DB).execute(
      sql.raw(
        "truncate workspaces, workspace_members, settings, users, sessions, trusted_browsers, invites, password_resets, email_verifications, connections, products, product_gateways, transactions, webhook_events, webhook_deliveries, audit_log, notifications, notification_preferences, jobs, licences, billing_plans, billing_prices, exchange_rates, platform_audit_log, invoices, billing_payment_methods, billing_charges, mcp_settings, mcp_connections, mcp_tokens, mcp_tool_calls cascade",
      ),
    )
    // Put back what migration 0007 seeds: the Standard plan and its first price.
    const migration = readFileSync(new URL("../drizzle/0007_platform_and_pricing.sql", import.meta.url), "utf8")
    for (const statement of migration.split("--> statement-breakpoint").filter((q) => q.includes("INSERT INTO"))) {
      await app.get<Db>(DB).execute(sql.raw(statement))
    }
    // ...and the later migrations that add new paid features to it.
    for (const file of ["0017_mcp.sql"]) {
      const later = readFileSync(new URL(`../drizzle/${file}`, import.meta.url), "utf8")
      for (const statement of later.split("--> statement-breakpoint").filter((q) => q.includes('UPDATE "billing_plans"'))) {
        await app.get<Db>(DB).execute(sql.raw(statement))
      }
    }
  }
  const server = app.getHttpServer()
  return {
    app,
    config,
    net,
    db: app.get<Db>(DB),
    http: () => supertest(server),
    agent: () => supertest.agent(server),
    mailer: app.get(MailerService),
    jobs: app.get(JobsService),
    deliveries: app.get(DeliveriesService),
    close: () => app.close(),
  }
}

export type TestApp = Awaited<ReturnType<typeof createTestApp>>

/** Creates the owner through first-run setup and returns a signed-in agent. */
export async function setupOwner(t: TestApp) {
  const agent = t.agent()
  const res = await agent.post("/api/auth/setup").send(OWNER).expect(201)
  return { agent, user: res.body.user as { id: string }, workspaceId: res.body.user.workspace.id as string }
}

/** Invites someone and accepts the invite; returns their signed-in agent. */
export async function addMember(t: TestApp, owner: ReturnType<TestApp["agent"]>, input: { email: string; role: string; productIds?: string[] | null; name?: string }) {
  const res = await owner
    .post("/api/team/invites")
    .send({ email: input.email, role: input.role, productIds: input.productIds ?? null })
    .expect(201)
  const token = String(res.body.inviteUrl).split("/invite/")[1]
  const agent = t.agent()
  await agent.post(`/api/auth/invites/${token}/accept`).send({ name: input.name ?? "Team Member", password: "another-long-password" }).expect(201)
  return agent
}

export const PAYSTACK_TEST = { publicKey: "pk_test_1234567890abcdefghij", secretKey: "sk_test_1234567890abcdefghij" }
export const FLUTTERWAVE_TEST = {
  publicKey: "FLWPUBK_TEST-1234567890abcdef-X",
  secretKey: "FLWSECK_TEST-1234567890abcdef-X",
  encryptionKey: "FLWSECK_TEST1234",
  secretHash: "a-very-long-secret-hash",
}

export async function installGateway(owner: ReturnType<TestApp["agent"]>, gatewayId: "paystack" | "flutterwave", label = "Sandbox") {
  const res = await owner
    .post("/api/connections")
    .send({ gatewayId, label, mode: "test", credentials: gatewayId === "paystack" ? PAYSTACK_TEST : FLUTTERWAVE_TEST })
    .expect(201)
  return res.body as { id: string }
}

export async function createProduct(owner: ReturnType<TestApp["agent"]>, connectionId: string, overrides: Record<string, unknown> = {}) {
  const res = await owner
    .post("/api/products")
    .send({
      name: "Shopwise",
      kind: "website",
      websiteUrl: "https://shop.example.test",
      colorSlot: 1,
      referencePrefix: "SHW",
      gateways: [{ connectionId, isDefault: true }],
      webhookUrl: "https://shop.example.test/hooks/yaropay",
      successUrl: "https://shop.example.test/paid",
      failureUrl: "https://shop.example.test/failed",
      cancelUrl: "https://shop.example.test/cart",
      ...overrides,
    })
    .expect(201)
  return res.body as { product: { id: string; referencePrefix: string }; apiKey: string; testApiKey: string; signingSecret: string }
}
