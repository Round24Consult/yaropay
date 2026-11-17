import { eq } from "drizzle-orm"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { transactions } from "../src/database/schema.js"
import type { FinalizeParams, GatewayAdapter, PaymentRef } from "../src/gateways/kit.js"
import { paystackAdapter } from "../src/gateways/paystack/adapter.js"
import { createProduct, createTestApp, installGateway, setupOwner, type TestApp } from "./helpers.js"

/**
 * The adapter hooks batch 2 gateways need (a checkout id from initialize, finalize on the customer's
 * return), exercised through the real payment flow by giving the Paystack adapter those hooks for a test.
 */
describe("gateway kit hooks in the payment flow", () => {
  let t: TestApp
  let product: Awaited<ReturnType<typeof createProduct>>
  const original = { initialize: paystackAdapter.initialize, verify: paystackAdapter.verify }
  const adapter = paystackAdapter as GatewayAdapter & { finalize?: GatewayAdapter["finalize"] }
  const verified: PaymentRef[] = []

  beforeEach(async () => {
    t = await createTestApp()
    const owner = (await setupOwner(t)).agent
    product = await createProduct(owner, (await installGateway(owner, "paystack")).id)
    verified.length = 0
    adapter.initialize = async (ctx, creds, params) => ({ ...(await original.initialize(ctx, creds, params)), checkoutId: `chk_${params.reference}` })
    adapter.verify = async (ctx, creds, ref) => {
      verified.push(ref)
      return original.verify(ctx, creds, ref)
    }
  })
  afterEach(async () => {
    adapter.initialize = original.initialize
    adapter.verify = original.verify
    delete adapter.finalize
    await t.close()
  })

  const start = () =>
    t
      .http()
      .post(`/v1/products/${product.product.id}/payments`)
      .set("authorization", `Bearer ${product.testApiKey}`)
      .send({ amount: 1_500_000, currency: "NGN", email: "kemi@example.test" })
      .expect(201)

  it("stores the checkout id and hands it back to finalize, then verify, when the customer returns", async () => {
    const calls: string[] = []
    const finalize = vi.fn(async (_ctx: unknown, _creds: unknown, params: FinalizeParams) => {
      calls.push("finalize")
      // Approval only moves money once it's completed, as with a PayPal capture.
      t.net.setStatus(params.reference, "success")
    })
    adapter.finalize = finalize
    const { reference } = (await start()).body
    const [row] = await t.db.select().from(transactions).where(eq(transactions.reference, reference))
    expect(row.checkoutId).toBe(`chk_${reference}`)

    const cb = await t.http().get(`/v1/callback/${product.product.id}/paystack?reference=${reference}&token=abc`).expect(303)
    expect(new URL(cb.headers.location).searchParams.get("status")).toBe("success")
    expect(finalize).toHaveBeenCalledTimes(1)
    expect(finalize.mock.calls[0][2]).toMatchObject({ reference, checkoutId: `chk_${reference}`, query: { reference, token: "abc" } })
    expect(verified.at(-1)).toMatchObject({ reference, checkoutId: `chk_${reference}` })
    expect(calls).toEqual(["finalize"])
  })

  it("still verifies when finalize fails, so the gateway's answer decides", async () => {
    adapter.finalize = vi.fn(async () => {
      throw new Error("ORDER_NOT_APPROVED")
    })
    const { reference } = (await start()).body
    const cb = await t.http().get(`/v1/callback/${product.product.id}/paystack?reference=${reference}`).expect(303)
    expect(new URL(cb.headers.location).searchParams.get("status")).toBe("pending")
    expect(verified.at(-1)?.reference).toBe(reference)
  })

  it("doesn't finalize a payment that already has an outcome", async () => {
    const finalize = vi.fn(async () => {})
    adapter.finalize = finalize
    const { reference } = (await start()).body
    t.net.setStatus(reference, "success")
    await t.http().get(`/v1/callback/${product.product.id}/paystack?reference=${reference}`).expect(303)
    await t.http().get(`/v1/callback/${product.product.id}/paystack?reference=${reference}`).expect(303)
    expect(finalize).toHaveBeenCalledTimes(1)
  })
})
