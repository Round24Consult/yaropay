import { createHmac } from "node:crypto"
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { describeGatewayContract, fixture } from "../testing/contract.js"
import { paystackAdapter } from "./adapter.js"

const at = (name: string) => fixture(import.meta.url, `fixtures/${name}`)
const SECRET = "sk_test_fixture_not_a_real_key"
const webhookBody = readFileSync(new URL("fixtures/webhook-charge-success.json", import.meta.url), "utf8")
const callbackUrl = "https://pay.example.test/v1/callback/prd_fixture1/paystack"
const cancelUrl = `${callbackUrl}?outcome=cancelled&ct=0123456789abcdef`

describeGatewayContract(paystackAdapter, () => ({
  credentials: { publicKey: "pk_test_fixture_not_a_real_key", secretKey: SECRET },
  initialize: {
    params: {
      reference: "SHW_FIXTURE001",
      amount: 1500000,
      currency: "NGN",
      email: "kemi@example.com",
      callbackUrl,
      cancelUrl,
      metadata: { yaropay_product: "prd_fixture1", orderId: "1042" },
      channels: ["card", "bank_transfer"],
      title: "Shopwise",
    },
    route: "POST /transaction/initialize",
    response: { body: at("initialize.json") },
    // Paystack takes minor units (kobo) as they are.
    sends: {
      amount: 1500000,
      currency: "NGN",
      email: "kemi@example.com",
      reference: "SHW_FIXTURE001",
      callback_url: callbackUrl,
      channels: ["card", "bank_transfer"],
      metadata: { yaropay_product: "prd_fixture1", orderId: "1042", cancel_action: cancelUrl },
    },
    returns: { authorizationUrl: "https://checkout.paystack.com/fx0w8a2kq7lz1r3" },
  },
  verify: [
    {
      name: "a successful card payment",
      ref: { reference: "SHW_FIXTURE001" },
      route: "GET /transaction/verify/SHW_FIXTURE001",
      response: { body: at("verify-success.json") },
      expect: {
        status: "success",
        amount: 1500000,
        currency: "NGN",
        fee: 32500,
        channel: "card",
        paidAt: "2026-11-17T10:21:44.000Z",
        gatewayTransactionId: "4099260516",
        customer: { email: "kemi@example.com", name: "Kemi Adeyemi" },
        metadata: { yaropay_product: "prd_fixture1" },
      },
    },
    {
      name: "a declined payment",
      ref: { reference: "SHW_FIXTURE002" },
      route: "GET /transaction/verify/SHW_FIXTURE002",
      response: { body: at("verify-failed.json") },
      expect: { status: "failed", amount: 1500000, currency: "NGN", fee: 0, paidAt: null, message: "Declined" },
    },
    {
      name: "an abandoned checkout",
      ref: { reference: "SHW_FIXTURE003" },
      route: "GET /transaction/verify/SHW_FIXTURE003",
      response: { body: at("verify-abandoned.json") },
      expect: { status: "abandoned", amount: 1500000, currency: "NGN", channel: null, paidAt: null },
    },
    {
      name: "a reference Paystack doesn't know",
      ref: { reference: "SHW_UNKNOWN01" },
      route: "GET /transaction/verify/SHW_UNKNOWN01",
      response: { status: 404, body: at("verify-not-found.json") },
      expect: null,
    },
  ],
  webhook: {
    // HMAC-SHA512 of the raw body with the secret key.
    signed: { rawBody: webhookBody, headers: { "x-paystack-signature": createHmac("sha512", SECRET).update(webhookBody).digest("hex") } },
    events: [
      {
        name: "charge.success",
        body: JSON.parse(webhookBody),
        expect: {
          type: "charge.success",
          reference: "SHW_FIXTURE001",
          metadata: { yaropay_product: "prd_fixture1" },
          payment: { status: "success", amount: 1500000, currency: "NGN", fee: 32500, channel: "card" },
        },
      },
      {
        name: "refund.processed",
        body: at("webhook-refund-processed.json"),
        expect: { type: "refund.processed", reference: "SHW_FIXTURE001", payment: { status: "reversed", amount: 1500000, currency: "NGN" } },
      },
      { name: "an event YaroPay doesn't act on", body: { event: "transfer.success", data: { reference: "TRF_1" } }, expect: { type: "transfer.success", payment: null } },
    ],
  },
  callback: [
    { name: "back from checkout", query: { trxref: "SHW_FIXTURE001", reference: "SHW_FIXTURE001" }, expect: { reference: "SHW_FIXTURE001", outcome: null } },
    { name: "the signed cancel link", query: { outcome: "cancelled", reference: "SHW_FIXTURE001", ct: "0123456789abcdef" }, expect: { reference: "SHW_FIXTURE001", outcome: "cancelled" } },
  ],
  testConnection: { route: "GET /balance", ok: { body: at("balance.json") } },
}))

describe("Paystack specifics", () => {
  it("reads the reference from trxref when reference is missing", () => {
    expect(paystackAdapter.parseCallback({ trxref: "SHW_1" })).toMatchObject({ reference: "SHW_1", outcome: null })
  })
})
