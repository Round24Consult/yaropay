import { readFileSync } from "node:fs"
import { beforeEach, describe, expect, it } from "vitest"
import { GatewayError } from "../kit.js"
import { describeGatewayContract, fixture, type Responder } from "../testing/contract.js"
import { fakeGateway } from "../testing/fake-gateway.js"
import { clearPayPalTokens, paypalAdapter, toPayPalValue } from "./adapter.js"

const at = (name: string) => fixture(import.meta.url, `fixtures/${name}`)
const ORDER = "5O190127TN364715T"
const credentials = { clientId: "AXfixtureClientIdNotReal0123456789", clientSecret: "EXfixtureSecretNotReal0123456789", webhookId: "WH_FIXTURE_ID_0001" }
const webhookBody = readFileSync(new URL("fixtures/webhook-capture-completed.json", import.meta.url), "utf8")
const callbackUrl = "https://pay.example.test/v1/callback/prd_fixture1/paypal"
const cancelUrl = `${callbackUrl}?outcome=cancelled&ct=0123456789abcdef`
const transmission = {
  "paypal-auth-algo": "SHA256withRSA",
  "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-360caa42-fca2a594-a5cafa77",
  "paypal-transmission-id": "69cd13f0-d67a-11e5-baa3-778b53f4ae55",
  "paypal-transmission-sig": "lmI95Jx3Y9nhR5SJWlHVIWpg4AgFk7n9bCHSRxbrd8A9zrhdu2rMyFrmz2ZjFixtureSignature0001",
  "paypal-transmission-time": "2026-11-17T12:04:13Z",
}

/**
 * Stands in for PayPal's verify-webhook-signature: "SUCCESS" only for the exact transmission headers, the
 * webhook id and the event exactly as it was sent.
 */
const verifyWebhook: Responder = (req) => {
  const sent = req.parsed as Record<string, unknown>
  const ok =
    sent.auth_algo === transmission["paypal-auth-algo"] &&
    sent.cert_url === transmission["paypal-cert-url"] &&
    sent.transmission_id === transmission["paypal-transmission-id"] &&
    sent.transmission_sig === transmission["paypal-transmission-sig"] &&
    sent.transmission_time === transmission["paypal-transmission-time"] &&
    sent.webhook_id === credentials.webhookId &&
    req.body.includes(webhookBody)
  return { body: { verification_status: ok ? "SUCCESS" : "FAILURE" } }
}

const orderRoute = (id: string) => `GET /v2/checkout/orders/${id}` as const

beforeEach(() => clearPayPalTokens())

describeGatewayContract(paypalAdapter, () => ({
  credentials,
  routes: { "POST /v1/oauth2/token": { body: at("token.json") } },
  initialize: {
    params: {
      reference: "SHW_FIXTURE001",
      amount: 150000,
      currency: "USD",
      email: "kemi@example.com",
      callbackUrl,
      cancelUrl,
      metadata: { yaropay_product: "prd_fixture1" },
      title: "Shopwise",
    },
    route: "POST /v2/checkout/orders",
    response: { status: 201, body: at("initialize.json") },
    // PayPal takes a decimal string in major units.
    sends: {
      intent: "CAPTURE",
      purchase_units: [{ reference_id: "SHW_FIXTURE001", custom_id: "SHW_FIXTURE001", description: "Shopwise", amount: { currency_code: "USD", value: "1500.00" } }],
      payment_source: {
        paypal: {
          email_address: "kemi@example.com",
          experience_context: {
            return_url: `${callbackUrl}?reference=SHW_FIXTURE001`,
            cancel_url: `${cancelUrl}&reference=SHW_FIXTURE001`,
            user_action: "PAY_NOW",
            shipping_preference: "NO_SHIPPING",
            brand_name: "Shopwise",
          },
        },
      },
    },
    returns: { authorizationUrl: `https://www.sandbox.paypal.com/checkoutnow?token=${ORDER}`, checkoutId: ORDER },
  },
  verify: [
    {
      name: "a captured payment",
      ref: { reference: "SHW_FIXTURE001", checkoutId: ORDER },
      route: orderRoute(ORDER),
      response: { body: at("verify-success.json") },
      expect: {
        status: "success",
        amount: 150000,
        currency: "USD",
        fee: 5280,
        paidAt: "2026-11-17T12:04:11Z",
        gatewayTransactionId: "3C679366HH908993F",
        customer: { email: "kemi@example.com", name: "Kemi Adeyemi" },
      },
    },
    {
      name: "a declined capture",
      ref: { reference: "SHW_FIXTURE002", checkoutId: "8MC585209K746392H" },
      route: orderRoute("8MC585209K746392H"),
      response: { body: at("verify-failed.json") },
      expect: { status: "failed", amount: 150000, currency: "USD", fee: 0, paidAt: null, message: "DECLINED_BY_RISK_FRAUD_FILTERS" },
    },
    {
      name: "a voided order",
      ref: { reference: "SHW_FIXTURE003", checkoutId: "9VF33318HJ0218434" },
      route: orderRoute("9VF33318HJ0218434"),
      response: { body: at("verify-abandoned.json") },
      expect: { status: "abandoned", amount: 150000, currency: "USD", paidAt: null },
    },
    {
      name: "an order PayPal doesn't know",
      ref: { reference: "SHW_UNKNOWN01", checkoutId: "0UNKNOWN0000000X" },
      route: orderRoute("0UNKNOWN0000000X"),
      response: { status: 404, body: at("verify-not-found.json") },
      expect: null,
    },
  ],
  webhook: {
    signed: { rawBody: webhookBody, headers: transmission },
    routes: { "POST /v1/notifications/verify-webhook-signature": verifyWebhook },
    events: [
      {
        name: "PAYMENT.CAPTURE.COMPLETED",
        body: JSON.parse(webhookBody),
        expect: { type: "PAYMENT.CAPTURE.COMPLETED", reference: "SHW_FIXTURE001", payment: { status: "success", amount: 150000, currency: "USD", fee: 5280, gatewayTransactionId: "3C679366HH908993F" } },
      },
      {
        name: "CHECKOUT.ORDER.APPROVED asks YaroPay to capture",
        body: at("webhook-order-approved.json"),
        expect: { type: "CHECKOUT.ORDER.APPROVED", reference: "SHW_FIXTURE001", payment: null, needsFinalize: { checkoutId: ORDER } },
      },
      {
        name: "PAYMENT.CAPTURE.DECLINED",
        body: at("webhook-capture-declined.json"),
        expect: { type: "PAYMENT.CAPTURE.DECLINED", reference: "SHW_FIXTURE002", payment: { status: "failed", amount: 150000 } },
      },
      { name: "an event YaroPay doesn't act on", body: { event_type: "BILLING.PLAN.CREATED", resource: { id: "P-1" } }, expect: { type: "BILLING.PLAN.CREATED", payment: null } },
    ],
  },
  callback: [
    { name: "back from PayPal after approving", query: { reference: "SHW_FIXTURE001", token: ORDER, PayerID: "QYR5Z8XDVJNXQ" }, expect: { reference: "SHW_FIXTURE001", outcome: null, checkoutId: ORDER } },
    { name: "the signed cancel link", query: { outcome: "cancelled", ct: "0123456789abcdef", reference: "SHW_FIXTURE001", token: ORDER }, expect: { reference: "SHW_FIXTURE001", outcome: "cancelled" } },
  ],
  testConnection: {
    route: "POST /v1/oauth2/token",
    ok: { body: at("token.json") },
    rejected: { status: 401, body: { error: "invalid_client", error_description: "Client Authentication failed" } },
  },
  finalize: {
    params: { reference: "SHW_FIXTURE001", checkoutId: ORDER, query: { token: ORDER, PayerID: "QYR5Z8XDVJNXQ" } },
    route: `POST /v2/checkout/orders/${ORDER}/capture`,
    response: { status: 201, body: at("capture.json") },
  },
}))

describe("PayPal specifics", () => {
  const token = { "POST /v1/oauth2/token": { body: at("token.json") } } as const

  it("sends amounts with PayPal's decimal rules", () => {
    expect(toPayPalValue(150000, "USD")).toBe("1500.00")
    expect(toPayPalValue(5, "USD")).toBe("0.05")
    expect(toPayPalValue(5000, "JPY")).toBe("5000")
    expect(toPayPalValue(150000, "HUF")).toBe("1500") // ISO two-decimal, but PayPal takes whole forints
    expect(toPayPalValue(150000, "TWD")).toBe("1500")
    expect(() => toPayPalValue(150050, "HUF")).toThrow(GatewayError)
  })

  it("reuses an access token until it expires, and replaces one PayPal no longer accepts", async () => {
    const gw = fakeGateway({ ...token, [orderRoute(ORDER)]: { body: at("verify-success.json") } })
    await paypalAdapter.verify(gw.ctx, credentials, { reference: "SHW_FIXTURE001", checkoutId: ORDER })
    await paypalAdapter.verify(gw.ctx, credentials, { reference: "SHW_FIXTURE001", checkoutId: ORDER })
    expect(gw.sent.filter((r) => r.path === "/v1/oauth2/token")).toHaveLength(1)
    expect(gw.sent[1].headers.authorization).toBe("Bearer A21AAFixtureAccessTokenNotReal")

    let rejected = true
    const revoked = fakeGateway({
      ...token,
      [orderRoute(ORDER)]: () => (rejected ? ((rejected = false), { status: 401, body: { error: "invalid_token" } }) : { body: at("verify-success.json") }),
    })
    expect(await paypalAdapter.verify(revoked.ctx, credentials, { reference: "SHW_FIXTURE001", checkoutId: ORDER })).toMatchObject({ status: "success" })
    // The cached token was refused once, so exactly one fresh token was fetched and the call retried.
    expect(revoked.sent.filter((r) => r.path === "/v1/oauth2/token")).toHaveLength(1)
    expect(revoked.sent.filter((r) => r.path === `/v2/checkout/orders/${ORDER}`)).toHaveLength(2)
  })

  it("treats capturing an already captured or unapproved order as done, and leaves the outcome to verify", async () => {
    const gw = fakeGateway({ ...token, [`POST /v2/checkout/orders/${ORDER}/capture`]: { status: 422, body: { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "ORDER_ALREADY_CAPTURED" }] } } })
    await expect(paypalAdapter.finalize!(gw.ctx, credentials, { reference: "SHW_FIXTURE001", checkoutId: ORDER, query: {} })).resolves.toBeUndefined()
    const capture = gw.sent.find((r) => r.path.endsWith("/capture"))
    expect(capture?.headers["paypal-request-id"]).toBe("yaropay-capture-SHW_FIXTURE001")
  })

  it("never captures an order taken from the return URL alone", async () => {
    const gw = fakeGateway({ ...token })
    await paypalAdapter.finalize!(gw.ctx, credentials, { reference: "SHW_FIXTURE001", checkoutId: null, query: { token: ORDER } })
    expect(gw.sent).toHaveLength(0)
  })

  it("reads a capture by id when YaroPay doesn't have the order id", async () => {
    const gw = fakeGateway({ ...token, "GET /v2/payments/captures/3C679366HH908993F": { body: at("capture-resource.json") } })
    const payment = await paypalAdapter.verify(gw.ctx, credentials, { reference: "SHW_FIXTURE001", gatewayTransactionId: "3C679366HH908993F" })
    expect(payment).toMatchObject({ status: "success", amount: 150000, fee: 5280 })
  })

  it("ignores an order that belongs to another reference", async () => {
    const gw = fakeGateway({ ...token, [orderRoute(ORDER)]: { body: at("verify-success.json") } })
    expect(await paypalAdapter.verify(gw.ctx, credentials, { reference: "SHW_SOMETHING_ELSE", checkoutId: ORDER })).toBeNull()
  })

  it("refuses webhooks without asking PayPal until the webhook ID is added", async () => {
    const gw = fakeGateway({ ...token })
    const { webhookId: _id, ...withoutWebhookId } = credentials
    expect(await paypalAdapter.verifySignature(gw.ctx, withoutWebhookId, Buffer.from(webhookBody), transmission)).toBe(false)
    expect(gw.sent).toHaveLength(0)
  })

  it("uses PayPal's sandbox host for test accounts and its live host for live ones", async () => {
    const { GATEWAYS } = await import("@yaropay/core/gateways/registry")
    const { gatewayApiBaseUrl } = await import("@yaropay/core/gateways/types")
    expect(gatewayApiBaseUrl(GATEWAYS.paypal, "test")).toBe("https://api-m.sandbox.paypal.com")
    expect(gatewayApiBaseUrl(GATEWAYS.paypal, "live")).toBe("https://api-m.paypal.com")
  })
})
