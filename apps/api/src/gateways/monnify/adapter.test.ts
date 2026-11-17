import { createHmac } from "node:crypto"
import { readFileSync } from "node:fs"
import { beforeEach, describe, expect, it } from "vitest"
import { describeGatewayContract, fixture } from "../testing/contract.js"
import { fakeGateway } from "../testing/fake-gateway.js"
import { clearMonnifyTokens, monnifyAdapter, monnifyDate, monnifyStatus } from "./adapter.js"

const at = (name: string) => fixture(import.meta.url, `fixtures/${name}`)
const SECRET = "FIXTURESECRETKEYNOTREAL000000000"
const credentials = { apiKey: "MK_TEST_FIXTURE01", secretKey: SECRET, contractCode: "1234567890" }
const webhookBody = readFileSync(new URL("fixtures/webhook-successful-transaction.json", import.meta.url), "utf8")
const callbackUrl = "https://pay.example.test/v1/callback/prd_fixture1/monnify"
const query = (ref: string) => `GET /api/v2/merchant/transactions/query?paymentReference=${ref}` as const

beforeEach(() => clearMonnifyTokens())

describeGatewayContract(monnifyAdapter, () => ({
  credentials,
  routes: { "POST /api/v1/auth/login": { body: at("login.json") } },
  initialize: {
    params: {
      reference: "SHW_FIXTURE001",
      amount: 1500000,
      currency: "NGN",
      email: "kemi@example.com",
      name: "Kemi Adeyemi",
      callbackUrl,
      cancelUrl: null,
      metadata: { yaropay_product: "prd_fixture1", orderId: "1042" },
      channels: ["card", "bank_transfer"],
      title: "Shopwise",
    },
    route: "POST /api/v1/merchant/transactions/init-transaction",
    response: { body: at("initialize.json") },
    // Monnify takes naira, not kobo.
    sends: {
      amount: 15000,
      customerName: "Kemi Adeyemi",
      customerEmail: "kemi@example.com",
      paymentReference: "SHW_FIXTURE001",
      paymentDescription: "Shopwise",
      currencyCode: "NGN",
      contractCode: "1234567890",
      redirectUrl: `${callbackUrl}?reference=SHW_FIXTURE001`,
      paymentMethods: ["CARD", "ACCOUNT_TRANSFER"],
      metaData: { yaropay_product: "prd_fixture1", orderId: "1042", yaropay_reference: "SHW_FIXTURE001" },
    },
    returns: { authorizationUrl: "https://sandbox.sdk.monnify.com/checkout/MNFY|20261117120230|000123", checkoutId: "MNFY|20261117120230|000123" },
  },
  verify: [
    {
      name: "a paid card payment",
      ref: { reference: "SHW_FIXTURE001" },
      route: query("SHW_FIXTURE001"),
      response: { body: at("verify-success.json") },
      expect: {
        status: "success",
        amount: 1500000,
        currency: "NGN",
        fee: 10750,
        channel: "card",
        paidAt: "2026-11-17T12:04:11.000Z",
        gatewayTransactionId: "MNFY|20261117120230|000123",
        customer: { email: "kemi@example.com", name: "Kemi Adeyemi" },
        metadata: { yaropay_product: "prd_fixture1" },
      },
    },
    {
      name: "a failed payment",
      ref: { reference: "SHW_FIXTURE002" },
      route: query("SHW_FIXTURE002"),
      response: { body: at("verify-failed.json") },
      expect: { status: "failed", amount: 1500000, currency: "NGN", fee: 0, paidAt: null },
    },
    {
      name: "a checkout that expired unpaid",
      ref: { reference: "SHW_FIXTURE003" },
      route: query("SHW_FIXTURE003"),
      response: { body: at("verify-abandoned.json") },
      expect: { status: "abandoned", amount: 1500000, currency: "NGN", channel: null, paidAt: null },
    },
    {
      name: "a reference Monnify doesn't know",
      ref: { reference: "SHW_UNKNOWN01" },
      route: query("SHW_UNKNOWN01"),
      response: { status: 404, body: at("verify-not-found.json") },
      expect: null,
    },
  ],
  webhook: {
    // HMAC-SHA512 of the raw body with the secret key.
    signed: { rawBody: webhookBody, headers: { "monnify-signature": createHmac("sha512", SECRET).update(webhookBody).digest("hex") } },
    events: [
      {
        name: "SUCCESSFUL_TRANSACTION",
        body: JSON.parse(webhookBody),
        expect: {
          type: "SUCCESSFUL_TRANSACTION",
          reference: "SHW_FIXTURE001",
          metadata: { yaropay_product: "prd_fixture1" },
          payment: { status: "success", amount: 1500000, currency: "NGN", fee: 10750, channel: "card", paidAt: "2026-11-17T12:04:11.000Z" },
        },
      },
      {
        name: "REJECTED_PAYMENT",
        body: at("webhook-rejected-payment.json"),
        expect: { type: "REJECTED_PAYMENT", reference: "SHW_FIXTURE002", payment: { status: "failed", channel: "bank_transfer" } },
      },
      { name: "an event YaroPay doesn't act on", body: { eventType: "SUCCESSFUL_DISBURSEMENT", eventData: { reference: "TRF_1" } }, expect: { type: "SUCCESSFUL_DISBURSEMENT", payment: null } },
    ],
  },
  callback: [
    { name: "back from checkout", query: { reference: "SHW_FIXTURE001", paymentReference: "SHW_FIXTURE001" }, expect: { reference: "SHW_FIXTURE001", outcome: null } },
    { name: "only Monnify's own parameter", query: { paymentReference: "SHW_FIXTURE001" }, expect: { reference: "SHW_FIXTURE001" } },
  ],
  testConnection: {
    route: "POST /api/v1/auth/login",
    ok: { body: at("login.json") },
    rejected: { status: 401, body: { requestSuccessful: false, responseMessage: "Invalid client credentials", responseCode: "99" } },
  },
}))

describe("Monnify specifics", () => {
  const login = { "POST /api/v1/auth/login": { body: at("login.json") } } as const

  it("maps every documented payment status", () => {
    expect(monnifyStatus("PAID")).toBe("success")
    expect(monnifyStatus("OVERPAID")).toBe("success")
    expect(monnifyStatus("PARTIALLY_PAID")).toBe("failed")
    expect(monnifyStatus("FAILED")).toBe("failed")
    expect(monnifyStatus("PENDING")).toBe("pending")
    expect(monnifyStatus("ABANDONED")).toBe("abandoned")
    expect(monnifyStatus("REVERSED")).toBe("reversed")
  })

  it("explains a partial payment instead of calling it paid", async () => {
    const partial = structuredClone(fixture<{ responseBody: Record<string, unknown> }>(import.meta.url, "fixtures/verify-success.json"))
    Object.assign(partial.responseBody, { paymentStatus: "PARTIALLY_PAID", amountPaid: "9000.00", settlementAmount: "8930.00" })
    const gw = fakeGateway({ ...login, [query("SHW_FIXTURE001")]: { body: partial } })
    const payment = await monnifyAdapter.verify(gw.ctx, credentials, { reference: "SHW_FIXTURE001" })
    expect(payment).toMatchObject({ status: "failed", amount: 900000, message: expect.stringContaining("less than the amount due") })
  })

  it("reads an unknown reference reported with an error status as not found", async () => {
    const gw = fakeGateway({ ...login, [query("SHW_UNKNOWN01")]: { status: 400, body: at("verify-not-found.json") } })
    expect(await monnifyAdapter.verify(gw.ctx, credentials, { reference: "SHW_UNKNOWN01" })).toBeNull()
  })

  it("signs in once and reuses the token", async () => {
    const gw = fakeGateway({ ...login, [query("SHW_FIXTURE001")]: { body: at("verify-success.json") } })
    await monnifyAdapter.verify(gw.ctx, credentials, { reference: "SHW_FIXTURE001" })
    await monnifyAdapter.verify(gw.ctx, credentials, { reference: "SHW_FIXTURE001" })
    expect(gw.sent.filter((r) => r.path === "/api/v1/auth/login")).toHaveLength(1)
    const signIn = gw.sent.find((r) => r.path === "/api/v1/auth/login")
    expect(signIn?.headers.authorization).toBe(`Basic ${Buffer.from(`MK_TEST_FIXTURE01:${SECRET}`).toString("base64")}`)
  })

  it("accepts the signature Monnify's Node samples compute over the re-serialised body", async () => {
    const gw = fakeGateway({})
    const pretty = JSON.stringify(JSON.parse(webhookBody), null, 2)
    const compactSignature = createHmac("sha512", SECRET).update(JSON.stringify(JSON.parse(webhookBody))).digest("hex")
    expect(await monnifyAdapter.verifySignature(gw.ctx, credentials, Buffer.from(pretty), { "monnify-signature": compactSignature })).toBe(true)
    expect(await monnifyAdapter.verifySignature(gw.ctx, credentials, Buffer.from(pretty), { "monnify-signature": "0".repeat(128) })).toBe(false)
  })

  it("reads Monnify's dates with or without an offset", () => {
    expect(monnifyDate("2026-11-17T13:04:11")).toBe("2026-11-17T12:04:11.000Z") // no offset: Lagos time
    expect(monnifyDate("2026-11-17 13:04:11.0")).toBe("2026-11-17T12:04:11.000Z")
    expect(monnifyDate("2026-11-17T12:04:11.000+0000")).toBe("2026-11-17T12:04:11.000Z")
    expect(monnifyDate("not a date")).toBeNull()
    expect(monnifyDate(null)).toBeNull()
  })

  it("never sends a customer name shorter than Monnify accepts", async () => {
    const gw = fakeGateway({ ...login, "POST /api/v1/merchant/transactions/init-transaction": { body: at("initialize.json") } })
    await monnifyAdapter.initialize(gw.ctx, credentials, { reference: "SHW_1", amount: 500000, currency: "NGN", email: "jo@example.com", callbackUrl, cancelUrl: null, metadata: {}, title: "" })
    const init = gw.sent.find((r) => r.path.endsWith("/init-transaction"))
    expect(init?.parsed).toMatchObject({ customerName: "Customer", paymentDescription: "Payment", amount: 5000 })
    expect(init?.parsed).not.toHaveProperty("paymentMethods")
  })
})
