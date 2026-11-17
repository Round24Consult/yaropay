import { createHmac } from "node:crypto"
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { GatewayError } from "../kit.js"
import { describeGatewayContract, fixture } from "../testing/contract.js"
import { fakeGateway } from "../testing/fake-gateway.js"
import { fromStripeAmount, SIGNATURE_TOLERANCE_SECONDS, stripeAdapter, toStripeAmount } from "./adapter.js"

const at = (name: string) => fixture(import.meta.url, `fixtures/${name}`)
const SECRET_KEY = "sk_test_fixture_not_a_real_key"
const WEBHOOK_SECRET = "whsec_fixture_not_a_real_signing_secret"
const credentials = { secretKey: SECRET_KEY, webhookSecret: WEBHOOK_SECRET }
const webhookBody = readFileSync(new URL("fixtures/webhook-checkout-session-completed.json", import.meta.url), "utf8")
const callbackUrl = "https://pay.example.test/v1/callback/prd_fixture1/stripe"
const cancelUrl = `${callbackUrl}?outcome=cancelled&ct=0123456789abcdef`

/** A Stripe-Signature header for the body, signed now (or `ageSeconds` ago) with the given secrets. */
function sign(body: string, opts: { secrets?: string[]; ageSeconds?: number; testSignature?: boolean } = {}) {
  const t = Math.floor(Date.now() / 1000) - (opts.ageSeconds ?? 0)
  const v1 = (opts.secrets ?? [WEBHOOK_SECRET]).map((s) => `v1=${createHmac("sha256", s).update(`${t}.${body}`).digest("hex")}`)
  // Sandbox events also carry a v0 test signature, which must be ignored.
  return [`t=${t}`, ...(opts.testSignature ? [`v0=${"0".repeat(64)}`] : []), ...v1].join(",")
}

const sessionRoute = (id: string) => `GET /v1/checkout/sessions/${id}` as const

describeGatewayContract(stripeAdapter, () => ({
  credentials,
  initialize: {
    params: {
      reference: "SHW_FIXTURE001",
      amount: 150000,
      currency: "USD",
      email: "kemi@example.com",
      callbackUrl,
      cancelUrl,
      metadata: { yaropay_product: "prd_fixture1", orderId: "1042" },
      channels: ["card"],
      title: "Shopwise",
    },
    route: "POST /v1/checkout/sessions",
    response: { body: at("initialize.json") },
    // Stripe takes the smallest unit (cents for USD), form-encoded.
    sends: {
      mode: "payment",
      client_reference_id: "SHW_FIXTURE001",
      customer_email: "kemi@example.com",
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][unit_amount]": "150000",
      "line_items[0][price_data][product_data][name]": "Shopwise",
      success_url: `${callbackUrl}?reference=SHW_FIXTURE001&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${cancelUrl}&reference=SHW_FIXTURE001`,
      "metadata[yaropay_product]": "prd_fixture1",
      "metadata[orderId]": "1042",
      "metadata[yaropay_reference]": "SHW_FIXTURE001",
      "payment_intent_data[metadata][yaropay_product]": "prd_fixture1",
    },
    returns: { authorizationUrl: "https://checkout.stripe.com/c/pay/cs_test_a1FixtureSessionOk01#fidkdWxOYHwnPyd1blpxYHZxWjA0", checkoutId: "cs_test_a1FixtureSessionOk01" },
  },
  verify: [
    {
      name: "a paid card payment",
      ref: { reference: "SHW_FIXTURE001", checkoutId: "cs_test_a1FixtureSessionOk01" },
      route: sessionRoute("cs_test_a1FixtureSessionOk01"),
      response: { body: at("verify-success.json") },
      expect: {
        status: "success",
        amount: 150000,
        currency: "USD",
        fee: 4380,
        channel: "card",
        paidAt: "2026-11-17T09:52:44.000Z",
        gatewayTransactionId: "pi_3FixturePaid0001",
        customer: { email: "kemi@example.com", name: "Kemi Adeyemi" },
        metadata: { yaropay_product: "prd_fixture1" },
      },
    },
    {
      name: "a bank debit that failed after checkout",
      ref: { reference: "SHW_FIXTURE002", checkoutId: "cs_test_a1FixtureSessionFail1" },
      route: sessionRoute("cs_test_a1FixtureSessionFail1"),
      response: { body: at("verify-failed.json") },
      expect: { status: "failed", amount: 150000, currency: "USD", fee: 0, paidAt: null, channel: "bank", message: "The customer's bank declined the debit." },
    },
    {
      name: "an expired checkout",
      ref: { reference: "SHW_FIXTURE003", checkoutId: "cs_test_a1FixtureSessionExp01" },
      route: sessionRoute("cs_test_a1FixtureSessionExp01"),
      response: { body: at("verify-abandoned.json") },
      expect: { status: "abandoned", amount: 150000, currency: "USD", channel: null, paidAt: null },
    },
    {
      name: "a session Stripe doesn't know",
      ref: { reference: "SHW_UNKNOWN01", checkoutId: "cs_test_unknown01" },
      route: sessionRoute("cs_test_unknown01"),
      response: { status: 404, body: at("verify-not-found.json") },
      expect: null,
    },
  ],
  webhook: {
    signed: { rawBody: webhookBody, headers: { "stripe-signature": sign(webhookBody) } },
    events: [
      {
        name: "checkout.session.completed, paid",
        body: JSON.parse(webhookBody),
        expect: {
          type: "checkout.session.completed",
          reference: "SHW_FIXTURE001",
          metadata: { yaropay_product: "prd_fixture1" },
          payment: { status: "success", amount: 150000, currency: "USD", gatewayTransactionId: "pi_3FixturePaid0001" },
        },
      },
      {
        name: "checkout.session.async_payment_failed",
        body: at("webhook-async-payment-failed.json"),
        expect: { type: "checkout.session.async_payment_failed", reference: "SHW_FIXTURE002", payment: { status: "failed", amount: 150000 } },
      },
      {
        name: "checkout.session.expired",
        body: at("webhook-session-expired.json"),
        expect: { type: "checkout.session.expired", reference: "SHW_FIXTURE003", payment: { status: "abandoned" } },
      },
      {
        name: "an event YaroPay doesn't act on",
        body: { type: "customer.created", data: { object: { object: "customer", id: "cus_1" } } },
        expect: { type: "customer.created", payment: null },
      },
    ],
  },
  callback: [
    {
      name: "back from a paid checkout",
      query: { reference: "SHW_FIXTURE001", session_id: "cs_test_a1FixtureSessionOk01" },
      expect: { reference: "SHW_FIXTURE001", outcome: null, checkoutId: "cs_test_a1FixtureSessionOk01" },
    },
    { name: "the signed cancel link", query: { outcome: "cancelled", ct: "0123456789abcdef", reference: "SHW_FIXTURE001" }, expect: { reference: "SHW_FIXTURE001", outcome: "cancelled" } },
  ],
  testConnection: { route: "GET /v1/balance", ok: { body: at("balance.json") } },
}))

describe("Stripe specifics", () => {
  it("converts amounts with Stripe's own decimal rules", () => {
    expect(toStripeAmount(150000, "USD")).toBe(150000)
    expect(toStripeAmount(5000, "JPY")).toBe(5000) // zero-decimal on both sides
    expect(toStripeAmount(5, "ISK")).toBe(500) // ISO zero-decimal, but Stripe wants two decimals ending in 00
    expect(toStripeAmount(5, "UGX")).toBe(500)
    expect(toStripeAmount(100000, "MGA")).toBe(1000) // ISO two-decimal, but Stripe counts whole ariary
    expect(() => toStripeAmount(100050, "MGA")).toThrow(GatewayError)
    expect(fromStripeAmount(500, "ISK")).toBe(5)
    expect(fromStripeAmount(1000, "MGA")).toBe(100000)
    expect(fromStripeAmount(5000, "JPY")).toBe(5000)
  })

  it("refuses a signature older than the tolerance, even when the HMAC matches", async () => {
    const gw = fakeGateway({})
    const stale = { "stripe-signature": sign(webhookBody, { ageSeconds: SIGNATURE_TOLERANCE_SECONDS + 60 }) }
    expect(await stripeAdapter.verifySignature(gw.ctx, credentials, Buffer.from(webhookBody), stale)).toBe(false)
    const recent = { "stripe-signature": sign(webhookBody, { ageSeconds: 30 }) }
    expect(await stripeAdapter.verifySignature(gw.ctx, credentials, Buffer.from(webhookBody), recent)).toBe(true)
  })

  it("accepts any v1 signature while a signing secret is being rolled, and never the v0 test signature alone", async () => {
    const gw = fakeGateway({})
    const rolled = { "stripe-signature": sign(webhookBody, { secrets: ["whsec_the_old_secret_for_this_endpoint", WEBHOOK_SECRET], testSignature: true }) }
    expect(await stripeAdapter.verifySignature(gw.ctx, credentials, Buffer.from(webhookBody), rolled)).toBe(true)
    const t = Math.floor(Date.now() / 1000)
    const v0Only = { "stripe-signature": `t=${t},v0=${createHmac("sha256", WEBHOOK_SECRET).update(`${t}.${webhookBody}`).digest("hex")}` }
    expect(await stripeAdapter.verifySignature(gw.ctx, credentials, Buffer.from(webhookBody), v0Only)).toBe(false)
  })

  it("refuses every webhook until the signing secret is added", async () => {
    const gw = fakeGateway({})
    const headers = { "stripe-signature": sign(webhookBody) }
    expect(await stripeAdapter.verifySignature(gw.ctx, { secretKey: SECRET_KEY }, Buffer.from(webhookBody), headers)).toBe(false)
  })

  it("finds a session by its payment intent when YaroPay has no session id", async () => {
    const gw = fakeGateway({ "GET /v1/checkout/sessions": { body: { object: "list", data: [at("verify-success.json")] } } })
    const payment = await stripeAdapter.verify(gw.ctx, credentials, { reference: "SHW_FIXTURE001", gatewayTransactionId: "pi_3FixturePaid0001" })
    expect(payment).toMatchObject({ status: "success", amount: 150000 })
    expect(gw.sent[0].path).toContain("payment_intent=pi_3FixturePaid0001")
  })

  it("ignores a session that belongs to another reference", async () => {
    const gw = fakeGateway({ [sessionRoute("cs_test_a1FixtureSessionOk01")]: { body: at("verify-success.json") } })
    expect(await stripeAdapter.verify(gw.ctx, credentials, { reference: "SHW_SOMETHING_ELSE", checkoutId: "cs_test_a1FixtureSessionOk01" })).toBeNull()
  })

  it("sends an idempotency key and pins the API version", async () => {
    const gw = fakeGateway({ "POST /v1/checkout/sessions": { body: at("initialize.json") } })
    await stripeAdapter.initialize(gw.ctx, credentials, {
      reference: "SHW_FIXTURE001",
      amount: 5000,
      currency: "JPY",
      email: "",
      callbackUrl,
      cancelUrl: null,
      metadata: {},
      title: "",
    })
    expect(gw.sent[0].headers["idempotency-key"]).toBe("yaropay-SHW_FIXTURE001")
    expect(gw.sent[0].headers["stripe-version"]).toMatch(/^\d{4}-\d{2}-\d{2}/)
    expect(gw.sent[0].parsed).toMatchObject({ "line_items[0][price_data][currency]": "jpy", "line_items[0][price_data][unit_amount]": "5000" })
    expect(gw.sent[0].parsed).not.toHaveProperty("cancel_url")
    expect(gw.sent[0].parsed).not.toHaveProperty("customer_email")
  })
})
