import { Inject, Injectable } from "@nestjs/common"
import {
  ONBOARDING_STEPS,
  type OnboardingStatus,
  type OnboardingStepId,
  type SampleDataRemoved,
} from "@yaropay/core/onboarding"
import { and, asc, count, eq, inArray, isNull, or, sql } from "drizzle-orm"
import { isIP } from "node:net"
import { AuditService } from "../audit/audit.service.js"
import type { Actor, AuditContext } from "../auth/types.js"
import { conflict } from "../common/errors.js"
import { isPrivateAddress } from "../common/ssrf.js"
import { APP_CONFIG, type AppConfig } from "../config/config.js"
import { DB } from "../database/database.module.js"
import { type Db, rowsOf } from "../database/db.js"
import { auditLog, connections, notifications, products, transactions, webhookEvents, workspaceMembers } from "../database/schema.js"
import { productCondition, scopeOf } from "../auth/scope.js"
import { insertSampleData } from "../demo/seed.js"
import { SettingsService } from "../settings/settings.service.js"

/** A base URL a gateway on the internet can reach: https on a public host. */
export function isPublicBaseUrl(value: string): boolean {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.protocol !== "https:") return false
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase()
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return false
  if (isIP(host)) return !isPrivateAddress(host)
  return host.includes(".")
}

interface Counts {
  real_connections: number
  sample_connections: number
  real_products: number
  sample_products: number
  gateway_event: boolean
  paid: boolean
  delivered: boolean
  members: number
  invited: boolean
}

@Injectable()
export class OnboardingService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  async status(actor: Actor): Promise<OnboardingStatus> {
    const settings = await this.settings.row()
    const ws = actor.workspaceId
    // Sample rows never count towards setup: the guide tracks the workspace's real data.
    const [c] = rowsOf<Counts>(
      await this.db.execute(sql`
        select
          (select count(*) from connections where workspace_id = ${ws} and not sample)::int as real_connections,
          (select count(*) from connections where workspace_id = ${ws} and sample)::int as sample_connections,
          (select count(*) from products where workspace_id = ${ws} and not sample)::int as real_products,
          (select count(*) from products where workspace_id = ${ws} and sample)::int as sample_products,
          exists (select 1 from webhook_events e join connections c on c.id = e.connection_id
                  where e.workspace_id = ${ws} and not c.sample and e.signature_valid) as gateway_event,
          exists (select 1 from transactions t join products p on p.id = t.product_id
                  where t.workspace_id = ${ws} and not p.sample and t.status = 'success') as paid,
          exists (select 1 from webhook_deliveries d join products p on p.id = d.product_id
                  where d.workspace_id = ${ws} and not p.sample and d.state = 'delivered') as delivered,
          (select count(*) from workspace_members where workspace_id = ${ws} and disabled_at is null)::int as members,
          exists (select 1 from invites where workspace_id = ${ws} and accepted_at is null and revoked_at is null and expires_at > now()) as invited
      `),
    )

    const done: Record<OnboardingStepId, boolean> = {
      base_url: isPublicBaseUrl(settings.baseUrl),
      gateway: c.real_connections > 0,
      gateway_webhook: c.gateway_event,
      product: c.real_products > 0,
      test_payment: c.paid,
      product_webhook: c.delivered,
      team: c.members > 1 || c.invited,
    }
    const steps = ONBOARDING_STEPS.map((s) => ({ id: s.id, done: done[s.id] }))
    const required = ONBOARDING_STEPS.filter((s) => !s.optional)

    const [connection] = await this.db
      .select({ id: connections.id })
      .from(connections)
      .where(and(eq(connections.workspaceId, ws), eq(connections.sample, false)))
      .orderBy(asc(connections.createdAt))
      .limit(1)
    const [product] = await this.db
      .select({ id: products.id })
      .from(products)
      .where(and(eq(products.workspaceId, ws), eq(products.sample, false), productCondition(products.id, scopeOf(actor))))
      .orderBy(asc(products.createdAt))
      .limit(1)
    const [me] = await this.db
      .select({ dismissedAt: workspaceMembers.onboardingDismissedAt })
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, ws), eq(workspaceMembers.userId, actor.id)))

    const samplePresent = c.sample_connections + c.sample_products > 0
    return {
      steps,
      completed: required.filter((s) => done[s.id]).length,
      total: required.length,
      dismissed: Boolean(me?.dismissedAt),
      sampleData: {
        present: samplePresent,
        canLoad: !samplePresent && c.real_connections === 0 && c.real_products === 0,
      },
      connectionId: connection?.id ?? null,
      productId: product?.id ?? null,
    }
  }

  async setDismissed(actor: Actor, dismissed: boolean) {
    await this.db
      .update(workspaceMembers)
      .set({ onboardingDismissedAt: dismissed ? new Date() : null })
      .where(and(eq(workspaceMembers.workspaceId, actor.workspaceId), eq(workspaceMembers.userId, actor.id)))
  }

  /** Loads the sample company into an empty workspace. */
  async loadSample(ctx: AuditContext) {
    const ws = ctx.workspaceId
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`yaropay.sample_data:${ws}`}))`)
      const [{ n: productCount }] = await tx.select({ n: count() }).from(products).where(eq(products.workspaceId, ws))
      const [{ n: connectionCount }] = await tx.select({ n: count() }).from(connections).where(eq(connections.workspaceId, ws))
      if (productCount > 0 || connectionCount > 0) {
        throw conflict("Sample data can only be added to an empty install, before any product or gateway account exists.")
      }
      // The sample audit log credits the person loading it with the owner's past changes.
      const { counts } = await insertSampleData(tx, this.config, { workspaceId: ws, ownerName: ctx.actorName })
      await this.audit.record(ctx, "Loaded sample data", `${counts.products} products, ${counts.transactions} payments`, tx)
      return counts
    })
  }

  /**
   * Deletes every sample product and gateway account with their payments,
   * events and deliveries. Real products, accounts and team members stay.
   */
  async removeSample(ctx: AuditContext): Promise<SampleDataRemoved> {
    const ws = ctx.workspaceId
    return this.db.transaction(async (tx) => {
      const sampleProducts = tx.select({ id: products.id }).from(products).where(and(eq(products.workspaceId, ws), eq(products.sample, true)))
      const sampleConnections = tx.select({ id: connections.id }).from(connections).where(and(eq(connections.workspaceId, ws), eq(connections.sample, true)))

      const removedTx = await tx
        .delete(transactions)
        .where(and(eq(transactions.workspaceId, ws), or(inArray(transactions.productId, sampleProducts), inArray(transactions.connectionId, sampleConnections))))
        .returning({ id: transactions.id })
      await tx.delete(webhookEvents).where(and(eq(webhookEvents.workspaceId, ws), inArray(webhookEvents.connectionId, sampleConnections)))
      await tx.delete(notifications).where(and(eq(notifications.workspaceId, ws), inArray(notifications.productId, sampleProducts)))
      // Product deletes cascade to their gateways and deliveries; real events matched to a sample product become unrouted.
      const removedProducts = await tx
        .delete(products)
        .where(and(eq(products.workspaceId, ws), eq(products.sample, true)))
        .returning({ id: products.id })
      const removedConnections = await tx
        .delete(connections)
        .where(and(eq(connections.workspaceId, ws), eq(connections.sample, true)))
        .returning({ id: connections.id })
      await tx.delete(auditLog).where(and(eq(auditLog.workspaceId, ws), eq(auditLog.sample, true), isNull(auditLog.actorId)))

      const removed = { products: removedProducts.length, connections: removedConnections.length, transactions: removedTx.length }
      if (removed.products || removed.connections) {
        await this.audit.record(ctx, "Removed sample data", `${removed.products} products, ${removed.connections} gateway accounts`, tx)
      }
      return removed
    })
  }
}
