import { HttpStatus, Inject, Injectable, Logger } from "@nestjs/common"
import { requireGateway } from "@yaropay/core/gateways/registry"
import { type CreatePaymentInput, eventTypeForStatus, type PaymentResponse, type ProductEvent } from "@yaropay/core/payments"
import { makeReference, PRODUCT_METADATA_KEY, resolveProduct } from "@yaropay/core/routing"
import type { CurrencyCode, GatewayId, Mode, PaymentChannel, TransactionStatus } from "@yaropay/core/types"
import { productCallbackUrl, productCancelUrl } from "@yaropay/core/urls"
import { and, asc, eq, sql } from "drizzle-orm"
import { createHmac, randomInt } from "node:crypto"
import { newId, safeEqual, sha256 } from "../common/crypto.js"
import { ApiException, conflict, notFound } from "../common/errors.js"
import { APP_CONFIG, type AppConfig } from "../config/config.js"
import { USAGE_SINK, type UsageSink } from "../extension/extension.js"
import { DB } from "../database/database.module.js"
import type { Db } from "../database/db.js"
import {
  type ConnectionRow,
  connections,
  productGateways,
  type ProductRow,
  products,
  type TimelineStepJson,
  transactions,
  type TransactionRowDb,
  webhookEvents,
  workspaces,
} from "../database/schema.js"
import { type CallbackParams, type GatewayPayment, GatewayError } from "../gateways/kit.js"
import { ConnectionsService } from "../gateways/connections.service.js"
import { NotificationsService } from "../notifications/notifications.service.js"
import { SettingsService } from "../settings/settings.service.js"
import { DeliveriesService } from "../webhooks/deliveries.service.js"
import { InvalidSignatureLimiter } from "./invalid-signature-limiter.js"

const TERMINAL: TransactionStatus[] = ["success", "failed", "abandoned", "reversed"]
/** Bodies of badly signed webhook posts larger than this are recorded by size only. */
const MAX_STORED_INVALID_BYTES = 4_096

/** Which status changes are allowed once a payment has an outcome. */
function canMove(from: TransactionStatus, to: TransactionStatus): boolean {
  if (from === to) return false
  if (from === "pending") return to !== "pending"
  if (from === "abandoned") return to === "success" || to === "failed"
  if (from === "failed") return to === "success"
  if (from === "success") return to === "reversed"
  return false
}

const step = (kind: string, title: string, detail: string | undefined, ok: boolean, at = new Date()): TimelineStepJson => ({
  kind,
  at: at.toISOString(),
  title,
  ...(detail ? { detail } : {}),
  ok,
})

export function toPaymentResponse(r: TransactionRowDb): PaymentResponse {
  return {
    id: r.id,
    reference: r.reference,
    productId: r.productId,
    gateway: r.gatewayId as GatewayId,
    connectionId: r.connectionId,
    mode: r.mode as Mode,
    amount: r.amount,
    currency: r.currency as CurrencyCode,
    status: r.status as TransactionStatus,
    channel: r.channel as PaymentChannel | null,
    authorizationUrl: r.status === "pending" ? r.authorizationUrl : null,
    metadata: r.metadata,
    createdAt: r.createdAt.toISOString(),
    paidAt: r.paidAt?.toISOString() ?? null,
  }
}

export type CallbackOutcome = { kind: "redirect"; url: string } | { kind: "error"; status: number; title: string; message: string }

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger("Payments")
  private readonly invalidPosts = new InvalidSignatureLimiter()
  /** Signs cancel links, so only the customer's own checkout can report a cancellation. */
  private readonly cancelLinkKey: Buffer

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly connections: ConnectionsService,
    private readonly deliveries: DeliveriesService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
    @Inject(USAGE_SINK) private readonly usage: UsageSink,
  ) {
    this.cancelLinkKey = createHmac("sha256", config.encryptionKey).update("yaropay:cancel-links").digest()
  }

  /**
   * Tells the paid build about a live payment (Cloud starts a trial with the first one). Never holds up or
   * fails a payment: problems are logged and the payment carries on.
   */
  private async recordLive(row: TransactionRowDb, product: ProductRow) {
    if (row.mode !== "live" || product.sample) return
    try {
      await this.usage.liveTransaction({ workspaceId: row.workspaceId, productId: row.productId, at: row.createdAt })
    } catch (e) {
      this.logger.warn(`Usage hook failed for ${row.id}: ${(e as Error).message}`)
    }
  }

  /** Token added to a payment's cancel link. Only YaroPay can compute it; the gateway hands it to the customer's browser. */
  private cancelToken(reference: string): string {
    return createHmac("sha256", this.cancelLinkKey).update(reference).digest("hex").slice(0, 32)
  }

  /** A workspace's products with their reference prefixes, for routing gateway events. */
  private routingTable(workspaceId: string) {
    return this.db.select({ id: products.id, referencePrefix: products.referencePrefix }).from(products).where(eq(products.workspaceId, workspaceId))
  }

  // ---- Product server API -------------------------------------------------

  /** Picks the connection for a payment: the requested gateway or the default, in the key's mode. */
  private async pickConnection(product: ProductRow, mode: Mode, gateway?: string): Promise<ConnectionRow> {
    const attached = await this.db
      .select({ connection: connections, isDefault: productGateways.isDefault })
      .from(productGateways)
      .innerJoin(connections, eq(connections.id, productGateways.connectionId))
      .where(and(eq(productGateways.productId, product.id), eq(connections.mode, mode)))
      .orderBy(asc(productGateways.position))
    const candidates = gateway && gateway !== "default" ? attached.filter((a) => a.connection.gatewayId === gateway) : attached
    const pick = candidates.find((a) => a.isDefault) ?? candidates[0]
    if (!pick) {
      const what = gateway && gateway !== "default" ? `${requireGateway(gateway).name} ${mode}` : mode
      throw conflict(`${product.name} has no ${what} gateway attached. Attach one in the dashboard first.`)
    }
    return pick.connection
  }

  async create(product: ProductRow, mode: Mode, input: CreatePaymentInput, idempotencyKey: string | null): Promise<{ created: boolean; payment: PaymentResponse }> {
    if (product.status !== "active") throw conflict(`${product.name} is paused. Resume it in the dashboard to take payments.`)
    // A suspended company can't start new payments; ones already started still complete (webhooks,
    // callbacks and deliveries don't check this).
    const [ws] = await this.db.select({ status: workspaces.status }).from(workspaces).where(eq(workspaces.id, product.workspaceId))
    if (ws?.status === "suspended") {
      throw new ApiException(HttpStatus.FORBIDDEN, "This YaroPay account is suspended, so it can't start new payments. Contact YaroPay support.", { code: "workspace_suspended" })
    }
    if (mode === "live" && !product.sample) {
      const refusal = await this.usage.liveRefusal({ workspaceId: product.workspaceId, productId: product.id }).catch((e: Error) => {
        this.logger.warn(`Live check failed for ${product.id}, letting the payment through: ${e.message}`)
        return null
      })
      if (refusal) throw new ApiException(HttpStatus.PAYMENT_REQUIRED, refusal, { code: "billing_past_due" })
    }
    if (idempotencyKey) {
      const [existing] = await this.db
        .select()
        .from(transactions)
        .where(and(eq(transactions.productId, product.id), eq(transactions.idempotencyKey, idempotencyKey)))
      if (existing) return { created: false, payment: toPaymentResponse(existing) }
    }
    if (input.reference && !input.reference.startsWith(`${product.referencePrefix}_`)) {
      throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "Some fields need attention", {
        code: "validation_failed",
        fields: { reference: `References for ${product.name} start with ${product.referencePrefix}_` },
      })
    }
    const connection = await this.pickConnection(product, mode, input.gateway)
    const gateway = requireGateway(connection.gatewayId)
    if (!gateway.currencies.includes(input.currency)) {
      throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "Some fields need attention", {
        code: "validation_failed",
        fields: { currency: `${gateway.name} doesn't accept ${input.currency}. It accepts ${gateway.currencies.join(", ")}.` },
      })
    }
    const adapter = this.connections.adapter(connection.gatewayId)
    const reference = input.reference ?? makeReference(product.referencePrefix, () => randomInt(0, 2 ** 32) / 2 ** 32)
    const baseUrl = await this.settings.baseUrl()
    const callbackUrl = productCallbackUrl(baseUrl, product.id, gateway.id)
    const cancelUrl = gateway.redirects.cancel ? `${productCancelUrl(baseUrl, product.id, gateway.id)}&ct=${this.cancelToken(reference)}` : null
    const metadata = { ...(input.metadata ?? {}), [PRODUCT_METADATA_KEY]: product.id }

    let row: TransactionRowDb
    try {
      ;[row] = await this.db
        .insert(transactions)
        .values({
          id: newId("txn"),
          workspaceId: product.workspaceId,
          reference,
          productId: product.id,
          connectionId: connection.id,
          gatewayId: connection.gatewayId,
          mode,
          amount: input.amount,
          currency: input.currency,
          status: "pending",
          customerEmail: input.email,
          customerName: input.name ?? "",
          metadata,
          idempotencyKey,
          timeline: [step("initialized", `Initialised by ${product.name}`, `POST /v1/products/${product.id}/payments with reference ${reference}`, true)],
        })
        .returning()
    } catch (e) {
      if (String((e as { code?: string }).code) === "23505" || /duplicate key/i.test((e as Error).message)) {
        throw conflict(`The reference ${reference} was already used`)
      }
      throw e
    }
    await this.recordLive(row, product)

    try {
      const result = await adapter.initialize(this.connections.context(connection), this.connections.credentials(connection), {
        reference,
        amount: input.amount,
        currency: input.currency,
        email: input.email,
        name: input.name,
        callbackUrl,
        cancelUrl,
        metadata,
        channels: input.channels,
        title: product.name,
      })
      const redirected = step(
        "redirected",
        `Checkout created on ${gateway.name}`,
        `${gateway.redirects.callbackField} set to the ${product.name} callback`,
        true,
      )
      ;[row] = await this.db
        .update(transactions)
        .set({ authorizationUrl: result.authorizationUrl, checkoutId: result.checkoutId ?? null, timeline: sql`${transactions.timeline} || ${JSON.stringify([redirected])}::jsonb`, updatedAt: new Date() })
        .where(eq(transactions.id, row.id))
        .returning()
      await this.connections.markActive(connection)
      return { created: true, payment: toPaymentResponse(row) }
    } catch (e) {
      const message = (e as Error).message
      await this.db
        .update(transactions)
        .set({
          status: "failed",
          timeline: sql`${transactions.timeline} || ${JSON.stringify([step("failed", `${gateway.name} refused to start the payment`, message, false)])}::jsonb`,
          updatedAt: new Date(),
        })
        .where(eq(transactions.id, row.id))
      if (e instanceof GatewayError && e.kind === "auth") await this.connections.markError(connection, message)
      throw new ApiException(HttpStatus.BAD_GATEWAY, message, { code: e instanceof GatewayError ? `gateway_${e.kind}` : "gateway_error" })
    }
  }

  async get(product: ProductRow, mode: Mode, reference: string, refresh: boolean): Promise<PaymentResponse> {
    const [row] = await this.db
      .select()
      .from(transactions)
      .where(and(eq(transactions.reference, reference), eq(transactions.productId, product.id), eq(transactions.mode, mode)))
    if (!row) throw notFound("Payment")
    if (!refresh || TERMINAL.includes(row.status as TransactionStatus)) return toPaymentResponse(row)
    const verified = await this.verifyRow(row)
    if (!verified) return toPaymentResponse(row)
    const { row: next } = await this.settle(row.id, verified, [step("verified", "Status checked with the gateway", "Requested by the product server", verified.status === "success")], null)
    return toPaymentResponse(next)
  }

  // ---- Settlement ------------------------------------------------------------

  private async verifyRow(row: TransactionRowDb, gatewayTransactionId?: string | null): Promise<GatewayPayment | null> {
    const connection = await this.connections.find(row.connectionId)
    if (!connection) return null
    const adapter = this.connections.adapter(connection.gatewayId)
    try {
      const payment = await adapter.verify(this.connections.context(connection), this.connections.credentials(connection), {
        reference: row.reference,
        gatewayTransactionId: gatewayTransactionId ?? row.gatewayTransactionId,
        checkoutId: row.checkoutId,
      })
      await this.connections.markActive(connection)
      return payment
    } catch (e) {
      if (e instanceof GatewayError && e.kind === "auth") await this.connections.markError(connection, e.message)
      throw e
    }
  }

  /**
   * Moves a payment to the gateway-reported status (idempotent, row-locked) and
   * queues the matching event for the product. The amount and currency must
   * match what the product asked for.
   */
  async settle(
    transactionId: string,
    payment: Omit<GatewayPayment, "message"> & { message?: string | null },
    steps: TimelineStepJson[],
    eventId: string | null,
  ): Promise<{ changed: boolean; row: TransactionRowDb }> {
    const result = await this.db.transaction(async (tx) => {
      const [row] = await tx.select().from(transactions).where(eq(transactions.id, transactionId)).for("update")
      const [product] = await tx.select().from(products).where(eq(products.id, row.productId))
      let status = payment.status
      const extra: TimelineStepJson[] = []
      if (status === "success" && (payment.currency !== row.currency || payment.amount < row.amount)) {
        status = "failed"
        extra.push(
          step(
            "failed",
            "Amount check failed",
            `Expected ${row.currency} ${row.amount}, the gateway reported ${payment.currency} ${payment.amount}. Not marked as paid.`,
            false,
          ),
        )
      }
      const from = row.status as TransactionStatus
      const changed = canMove(from, status)
      const values: Partial<typeof transactions.$inferInsert> = {
        updatedAt: new Date(),
        timeline: sql`${transactions.timeline} || ${JSON.stringify([...steps, ...extra])}::jsonb` as unknown as TimelineStepJson[],
      }
      if (payment.channel && !row.channel) values.channel = payment.channel
      if (payment.gatewayTransactionId && !row.gatewayTransactionId) values.gatewayTransactionId = payment.gatewayTransactionId
      if (payment.customer.name && !row.customerName) values.customerName = payment.customer.name
      if (changed) {
        values.status = status
        if (status === "success") {
          values.paidAt = payment.paidAt ? new Date(payment.paidAt) : new Date()
          values.fee = payment.fee
        }
      }
      const [updated] = await tx.update(transactions).set(values).where(eq(transactions.id, transactionId)).returning()
      let deliveryId: string | null = null
      const type = changed ? eventTypeForStatus(status) : null
      if (type && product) {
        const event: ProductEvent = {
          id: newId("pev"),
          type,
          mode: updated.mode as Mode,
          createdAt: new Date().toISOString(),
          data: {
            id: updated.id,
            reference: updated.reference,
            productId: updated.productId,
            gateway: updated.gatewayId as GatewayId,
            amount: updated.amount,
            fee: updated.fee,
            currency: updated.currency as CurrencyCode,
            status: updated.status as TransactionStatus,
            channel: updated.channel as PaymentChannel | null,
            customer: { email: updated.customerEmail, name: updated.customerName },
            metadata: updated.metadata,
            paidAt: updated.paidAt?.toISOString() ?? null,
          },
        }
        deliveryId = (await this.deliveries.enqueue({ product, event, transactionId: updated.id, eventId }, tx)).id
      }
      return { changed, row: updated, deliveryId }
    })
    // Send right away instead of waiting for the next worker tick.
    if (result.deliveryId && this.config.workers) {
      void this.deliveries.sendNow(result.deliveryId, false).catch(() => undefined)
    }
    return { changed: result.changed, row: result.row }
  }

  /** Records a payment the product started directly with the gateway (direct mode). */
  private async importPayment(product: ProductRow, connection: ConnectionRow, payment: GatewayPayment, via: string): Promise<TransactionRowDb> {
    const [row] = await this.db
      .insert(transactions)
      .values({
        id: newId("txn"),
        workspaceId: product.workspaceId,
        reference: payment.reference,
        productId: product.id,
        connectionId: connection.id,
        gatewayId: connection.gatewayId,
        mode: connection.mode,
        amount: payment.amount,
        currency: payment.currency,
        status: "pending",
        channel: payment.channel,
        customerEmail: payment.customer.email,
        customerName: payment.customer.name,
        metadata: payment.metadata,
        gatewayTransactionId: payment.gatewayTransactionId,
        timeline: [step("initialized", `Started by ${product.name} directly with ${requireGateway(connection.gatewayId).name}`, `First seen through the ${via}`, true)],
      })
      .onConflictDoNothing()
      .returning()
    if (row) {
      await this.recordLive(row, product)
      return row
    }
    const [existing] = await this.db
      .select()
      .from(transactions)
      .where(and(eq(transactions.workspaceId, product.workspaceId), eq(transactions.reference, payment.reference)))
    return existing
  }

  // ---- Customer redirect (callback) ----------------------------------------

  private redirectTo(product: ProductRow, row: TransactionRowDb | null, status: "success" | "failed" | "cancelled" | "pending", reference: string | null): string {
    const base = status === "success" || status === "pending" ? product.successUrl : status === "cancelled" ? (product.cancelUrl ?? product.failureUrl) : product.failureUrl
    const url = new URL(base)
    if (reference) url.searchParams.set("reference", reference)
    url.searchParams.set("status", status)
    if (row) url.searchParams.set("payment_id", row.id)
    return url.toString()
  }

  private outcomeOf(status: TransactionStatus): "success" | "failed" | "cancelled" | "pending" {
    if (status === "success" || status === "reversed") return "success"
    if (status === "abandoned") return "cancelled"
    if (status === "failed") return "failed"
    return "pending"
  }

  /** `/v1/callback/{productId}/{gateway}`: verify, settle, send the customer to the product. */
  async productCallback(productId: string, gatewayId: string, query: Record<string, string | undefined>): Promise<CallbackOutcome> {
    const [product] = await this.db.select().from(products).where(eq(products.id, productId))
    if (!product) return { kind: "error", status: 404, title: "Unknown product", message: "This payment link does not belong to any product on this install." }
    let adapter
    try {
      adapter = this.connections.adapter(gatewayId)
    } catch {
      return { kind: "error", status: 404, title: "Unknown gateway", message: "This callback URL names a gateway YaroPay does not support." }
    }
    const params = adapter.parseCallback(query)
    if (!params.reference) return { kind: "redirect", url: this.redirectTo(product, null, "failed", null) }

    let [row] = await this.db
      .select()
      .from(transactions)
      .where(and(eq(transactions.reference, params.reference), eq(transactions.productId, product.id)))
    if (!row) {
      // Direct mode: the product started the payment itself with our callback URL.
      if (!params.reference.toUpperCase().startsWith(`${product.referencePrefix}_`)) {
        return { kind: "redirect", url: this.redirectTo(product, null, "failed", params.reference) }
      }
      const imported = await this.findAndImport(product, gatewayId, params.reference, params.gatewayTransactionId, "callback")
      if (!imported) return { kind: "redirect", url: this.redirectTo(product, null, "failed", params.reference) }
      row = imported
    }
    return this.finishCallback(product, row, params, query)
  }

  /** `/v1/callback/{gateway}/{connectionId}`: the gateway-dashboard fallback callback. */
  async connectionCallback(gatewayId: string, connectionId: string, query: Record<string, string | undefined>): Promise<CallbackOutcome> {
    const connection = await this.connections.find(connectionId)
    if (!connection || connection.gatewayId !== gatewayId) {
      return { kind: "error", status: 404, title: "Unknown account", message: "This callback URL does not match an installed gateway account." }
    }
    const adapter = this.connections.adapter(gatewayId)
    const params = adapter.parseCallback(query)
    if (!params.reference) return { kind: "error", status: 400, title: "Missing reference", message: "The gateway did not say which payment this is." }
    // Everything below stays inside the gateway account's workspace.
    const ws = connection.workspaceId
    let [row] = await this.db
      .select()
      .from(transactions)
      .where(and(eq(transactions.workspaceId, ws), eq(transactions.reference, params.reference)))
    if (!row) {
      const payment = await adapter
        .verify(this.connections.context(connection), this.connections.credentials(connection), { reference: params.reference, gatewayTransactionId: params.gatewayTransactionId, checkoutId: params.checkoutId ?? null })
        .catch(() => null)
      const route = payment ? resolveProduct(await this.routingTable(ws), payment.reference, payment.metadata) : null
      if (!payment || !route?.productId) {
        return { kind: "error", status: 404, title: "Payment not matched", message: "YaroPay could not match this payment to a product. Contact the merchant with your payment reference." }
      }
      const [product] = await this.db.select().from(products).where(and(eq(products.workspaceId, ws), eq(products.id, route.productId)))
      row = await this.importPayment(product, connection, payment, "fallback callback")
    }
    const [product] = await this.db.select().from(products).where(and(eq(products.workspaceId, ws), eq(products.id, row.productId)))
    return this.finishCallback(product, row, params, query)
  }

  /**
   * Gives the gateway's adapter the chance to complete a payment the customer approved (PayPal captures
   * the order). A failure here isn't fatal: verify, which runs next, reports where the payment stands.
   */
  private async finalizeRow(row: TransactionRowDb, params: CallbackParams, query: Record<string, string | undefined>) {
    const adapter = this.connections.adapter(row.gatewayId)
    if (!adapter.finalize) return
    const connection = await this.connections.find(row.connectionId)
    if (!connection) return
    try {
      await adapter.finalize(this.connections.context(connection), this.connections.credentials(connection), {
        reference: row.reference,
        gatewayTransactionId: params.gatewayTransactionId ?? row.gatewayTransactionId,
        checkoutId: row.checkoutId ?? params.checkoutId ?? null,
        query,
      })
    } catch (e) {
      this.logger.warn(`Could not finalise ${row.reference} with ${row.gatewayId}: ${(e as Error).message}`)
    }
  }

  private async findAndImport(product: ProductRow, gatewayId: string, reference: string, gatewayTransactionId: string | null, via: string) {
    const attached = await this.db
      .select({ connection: connections })
      .from(productGateways)
      .innerJoin(connections, eq(connections.id, productGateways.connectionId))
      .where(and(eq(productGateways.productId, product.id), eq(connections.gatewayId, gatewayId)))
    for (const { connection } of attached) {
      const payment = await this.connections
        .adapter(gatewayId)
        .verify(this.connections.context(connection), this.connections.credentials(connection), { reference, gatewayTransactionId })
        .catch(() => null)
      if (payment) return this.importPayment(product, connection, payment, via)
    }
    return null
  }

  private async finishCallback(
    product: ProductRow,
    row: TransactionRowDb,
    params: CallbackParams,
    query: Record<string, string | undefined>,
  ): Promise<CallbackOutcome> {
    const cancelToken = query.ct ?? null
    const gatewayName = requireGateway(row.gatewayId).name
    const callbackStep = step(
      "callback",
      `${gatewayName} returned the customer`,
      `GET /v1/callback/${product.id}/${row.gatewayId}?reference=${row.reference}${params.outcome ? ` (${params.outcome})` : ""}`,
      params.outcome !== "cancelled" && params.outcome !== "failed",
    )
    if (params.outcome === "cancelled" && row.status === "pending") {
      // Anyone who knows a reference can open the callback URL with outcome=cancelled, so a
      // cancellation only counts when it's proven: the signed cancel link YaroPay gave the gateway,
      // or a gateway that itself reports the checkout as cancelled. If the gateway already has a real
      // outcome (paid or failed), that wins.
      let verified: GatewayPayment | null = null
      try {
        verified = await this.verifyRow(row, params.gatewayTransactionId)
      } catch (e) {
        this.logger.warn(`Could not verify cancelled ${row.reference}: ${(e as Error).message}`)
      }
      const decided = verified && (verified.status === "success" || verified.status === "failed" || verified.status === "reversed")
      if (!decided) {
        const signed = cancelToken !== null && safeEqual(cancelToken, this.cancelToken(row.reference))
        const gatewaySaysCancelled = verified?.status === "abandoned" && this.connections.adapter(row.gatewayId).confirmsCancellation
        if (signed || gatewaySaysCancelled) {
          const { row: next } = await this.settle(
            row.id,
            { ...blankPayment(row), status: "abandoned" },
            [callbackStep, step("failed", "Checkout cancelled", `The customer closed the ${gatewayName} checkout`, false)],
            null,
          )
          return { kind: "redirect", url: this.redirectTo(product, next, "cancelled", row.reference) }
        }
        // Unproven: the customer still goes to the cancel page, but the payment stays open and no event is sent.
        await this.db
          .update(transactions)
          .set({
            timeline: sql`${transactions.timeline} || ${JSON.stringify([
              { ...callbackStep, ok: false },
              step("callback", "Cancellation not confirmed", "Opened without YaroPay's signed cancel link; the payment stays open until the gateway reports an outcome", false),
            ])}::jsonb`,
          })
          .where(eq(transactions.id, row.id))
        return { kind: "redirect", url: this.redirectTo(product, row, "cancelled", row.reference) }
      }
    }
    if (TERMINAL.includes(row.status as TransactionStatus)) {
      return { kind: "redirect", url: this.redirectTo(product, row, this.outcomeOf(row.status as TransactionStatus), row.reference) }
    }
    if (params.outcome !== "failed") await this.finalizeRow(row, params, query)
    let verified: GatewayPayment | null = null
    try {
      verified = await this.verifyRow(row, params.gatewayTransactionId)
    } catch (e) {
      this.logger.warn(`Could not verify ${row.reference}: ${(e as Error).message}`)
    }
    if (!verified) {
      // Unknown for now: the webhook settles it. Send the customer to the success page as "pending".
      await this.db
        .update(transactions)
        .set({ timeline: sql`${transactions.timeline} || ${JSON.stringify([callbackStep, step("verified", "Verification pending", "The gateway has not confirmed this payment yet", false)])}::jsonb` })
        .where(eq(transactions.id, row.id))
      return { kind: "redirect", url: this.redirectTo(product, row, "pending", row.reference) }
    }
    const outcome = this.outcomeOf(verified.status)
    const { row: next } = await this.settle(
      row.id,
      verified,
      [
        callbackStep,
        step(
          "verified",
          verified.status === "success" ? "Payment verified with the gateway" : `Gateway reported the payment as ${verified.status}`,
          `Customer sent to the ${product.name} ${outcome === "success" ? "success" : outcome === "pending" ? "success (pending)" : outcome === "cancelled" ? "cancel" : "failure"} URL${verified.message ? `. Gateway said: ${verified.message}` : ""}`,
          verified.status === "success",
        ),
      ],
      null,
    )
    return { kind: "redirect", url: this.redirectTo(product, next, this.outcomeOf(next.status as TransactionStatus), row.reference) }
  }

  // ---- Gateway webhooks -------------------------------------------------------

  /** `/v1/webhooks/{gateway}/{connectionId}`: verify, store, route to one product, settle. */
  async ingest(
    gatewayId: string,
    connectionId: string,
    rawBody: Buffer | undefined,
    headers: Record<string, string | string[] | undefined>,
    senderAddress: string | null = null,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const connection = await this.connections.find(connectionId)
    if (!connection || connection.gatewayId !== gatewayId) return { status: 404, body: { error: { message: "Unknown webhook endpoint" } } }
    if (!rawBody?.length) return { status: 400, body: { error: { message: "Empty body" } } }
    const adapter = this.connections.adapter(gatewayId)
    let body: unknown
    try {
      body = JSON.parse(rawBody.toString("utf8"))
    } catch {
      return { status: 400, body: { error: { message: "Body must be JSON" } } }
    }
    const signatureValid = await adapter.verifySignature(this.connections.context(connection), this.connections.credentials(connection), rawBody, headers).catch((e: Error) => {
      this.logger.warn(`Could not check a ${gatewayId} webhook signature: ${e.message}`)
      return false
    })
    if (!signatureValid) {
      // Forged or misconfigured posts are capped, so knowing the URL can't fill the database.
      const limit = this.invalidPosts.record(senderAddress, connectionId)
      if (!limit.store) {
        return limit.throttle
          ? { status: 429, body: { error: { message: "Too many requests with an invalid signature" } } }
          : { status: 401, body: { error: { message: "Invalid signature" } } }
      }
      // Keep a small record only: the body of an unsigned post is whatever the sender chose.
      if (rawBody.length > MAX_STORED_INVALID_BYTES) body = { truncated: true, bytes: rawBody.length }
    }
    const parsed = adapter.parseWebhook(body)
    const gatewayName = requireGateway(gatewayId).name

    // Routing, within the gateway account's workspace only: an existing payment wins, then YaroPay's
    // metadata, then the reference prefix.
    const ws = connection.workspaceId
    let productId: string | null = null
    let matchedBy: string | null = null
    let existing: TransactionRowDb | undefined
    if (parsed.reference) {
      ;[existing] = await this.db
        .select()
        .from(transactions)
        .where(and(eq(transactions.workspaceId, ws), eq(transactions.reference, parsed.reference)))
      if (existing) {
        productId = existing.productId
        matchedBy = "reference"
      }
    }
    if (!productId) {
      const route = resolveProduct(await this.routingTable(ws), parsed.reference, parsed.metadata)
      productId = route.productId
      matchedBy = route.matchedBy
    }

    const dedupeKey = sha256(rawBody)
    let [event] = await this.db
      .insert(webhookEvents)
      .values({
        id: newId("evt"),
        workspaceId: ws,
        gatewayId,
        connectionId,
        mode: connection.mode,
        type: parsed.type,
        reference: parsed.reference,
        signatureValid,
        productId: signatureValid ? productId : null,
        matchedBy: signatureValid ? matchedBy : null,
        dedupeKey,
        payload: body as Record<string, unknown>,
      })
      .onConflictDoNothing()
      .returning()
    if (!event) {
      ;[event] = await this.db
        .select()
        .from(webhookEvents)
        .where(and(eq(webhookEvents.connectionId, connectionId), eq(webhookEvents.dedupeKey, dedupeKey)))
      if (event.processedAt || !event.signatureValid) return { status: 200, body: { received: true, duplicate: true } }
    }

    if (!signatureValid) {
      await this.notifications.notify({
        workspaceId: ws,
        type: "event.signature_invalid",
        severity: "critical",
        title: `Rejected a ${gatewayName} webhook with a bad signature`,
        body: `Someone posted a ${parsed.type} event to the ${connection.label} (${connection.mode}) webhook URL with an invalid ${requireGateway(gatewayId).webhook.signatureHeader}. It was stored and ignored.`,
        link: "/webhooks?tab=events",
        throttleKey: connectionId,
        throttleMs: 30 * 60_000,
      })
      return { status: 401, body: { error: { message: "Invalid signature" } } }
    }

    await this.connections.touch(connectionId)
    if (!productId) {
      await this.db.update(webhookEvents).set({ processedAt: new Date() }).where(eq(webhookEvents.id, event.id))
      await this.notifications.notify({
        workspaceId: ws,
        type: "event.unrouted",
        severity: "warning",
        title: `Unrouted ${gatewayName} event`,
        body: `A ${parsed.type} event${parsed.reference ? ` for ${parsed.reference}` : ""} matched no product. It was held for review and not forwarded.`,
        link: "/webhooks?tab=events&routing=unrouted",
        throttleKey: connectionId,
        throttleMs: 15 * 60_000,
      })
      return { status: 200, body: { received: true, routed: false } }
    }

    try {
      if (parsed.payment) {
        const [product] = await this.db.select().from(products).where(and(eq(products.workspaceId, ws), eq(products.id, productId)))
        let row = existing
        if (!row) row = await this.importPayment(product, connection, { ...parsed.payment, message: null }, "webhook")
        let payment = parsed.payment
        // Never trust a webhook alone for money: confirm successes with the gateway API.
        if (payment.status === "success") {
          const verified = await this.verifyRow(row, payment.gatewayTransactionId)
          if (!verified) throw new Error("The gateway could not confirm this payment")
          payment = verified
        }
        await this.settle(
          row.id,
          payment,
          [
            step("webhook_received", `${parsed.type} webhook received`, `${requireGateway(gatewayId).webhook.signatureHeader} checked`, true),
            step("routed", `Matched to ${product.name}`, matchedBy === "metadata" ? `metadata.${PRODUCT_METADATA_KEY} = ${product.id}` : matchedBy === "prefix" ? `Reference prefix ${product.referencePrefix}_` : "Known payment reference", true),
          ],
          event.id,
        )
      }
      await this.db.update(webhookEvents).set({ processedAt: new Date(), error: null }).where(eq(webhookEvents.id, event.id))
      return { status: 200, body: { received: true, routed: true } }
    } catch (e) {
      // Leave it unprocessed so the gateway's retry is handled, and say so.
      const message = (e as Error).message.slice(0, 300)
      await this.db.update(webhookEvents).set({ error: message }).where(eq(webhookEvents.id, event.id))
      this.logger.warn(`Webhook ${event.id} not processed yet: ${message}`)
      return { status: 503, body: { error: { message: "Temporarily unable to process this event; retry later" } } }
    }
  }
}

function blankPayment(row: TransactionRowDb): Omit<GatewayPayment, "message"> {
  return {
    reference: row.reference,
    status: row.status as TransactionStatus,
    amount: row.amount,
    currency: row.currency as CurrencyCode,
    channel: null,
    fee: 0,
    paidAt: null,
    gatewayTransactionId: null,
    customer: { email: row.customerEmail, name: "" },
    metadata: {},
  }
}

