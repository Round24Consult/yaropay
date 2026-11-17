import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { describeGatewayContract, fixture } from "../testing/contract.js"
import { flutterwaveAdapter, flutterwaveChannel } from "./adapter.js"

const at = (name: string) => fixture(import.meta.url, `fixtures/${name}`)
const HASH = "fixture-secret-hash"
const webhookBody = readFileSync(new URL("fixtures/webhook-charge-completed.json", import.meta.url), "utf8")
const callbackUrl = "https://pay.example.test/v1/callback/prd_fixture2/flutterwave"

describeGatewayContract(flutterwaveAdapter, () => ({
  credentials: { publicKey: "FLWPUBK_TEST-fixture-X", secretKey: "FLWSECK_TEST-fixture-X", secretHash: HASH },
  initialize: {
    params: {
      reference: "RDN_FIXTURE001",
      amount: 6550,
      currency: "GHS",
      email: "kofi@example.com",
      name: "Kofi Mensah",
      callbackUrl,
      cancelUrl: null,
      metadata: { yaropay_product: "prd_fixture2", cart: { items: 2 } },
      channels: ["mobile_money", "card"],
      title: "RideNow",
    },
    route: "POST /v3/payments",
    response: { body: at("initialize.json") },
    // Flutterwave takes major units: 6550 pesewas is GHS 65.50. `meta` only holds flat values.
    sends: {
      tx_ref: "RDN_FIXTURE001",
      amount: 65.5,
      currency: "GHS",
      redirect_url: callbackUrl,
      customer: { email: "kofi@example.com", name: "Kofi Mensah" },
      meta: { yaropay_product: "prd_fixture2", cart: '{"items":2}' },
      customizations: { title: "RideNow" },
      payment_options: "mobilemoneyghana,mobilemoneyuganda,mobilemoneyrwanda,mobilemoneyzambia,mpesa,card",
    },
    returns: { authorizationUrl: "https://checkout.flutterwave.com/v3/hosted/pay/fx9c2d4e6f" },
  },
  verify: [
    {
      name: "a successful mobile money payment, by reference",
      ref: { reference: "RDN_FIXTURE001" },
      route: "GET /v3/transactions/verify_by_reference?tx_ref=RDN_FIXTURE001",
      response: { body: at("verify-successful.json") },
      expect: {
        status: "success",
        amount: 6550,
        currency: "GHS",
        fee: 92,
        channel: "mobile_money",
        gatewayTransactionId: "1163068",
        customer: { email: "kofi@example.com", name: "Kofi Mensah" },
      },
    },
    {
      name: "a successful payment, by transaction id",
      ref: { reference: "RDN_FIXTURE001", gatewayTransactionId: "1163068" },
      route: "GET /v3/transactions/1163068/verify",
      response: { body: at("verify-successful.json") },
      expect: { status: "success", amount: 6550, currency: "GHS" },
    },
    {
      name: "a failed payment",
      ref: { reference: "RDN_FIXTURE002" },
      route: "GET /v3/transactions/verify_by_reference?tx_ref=RDN_FIXTURE002",
      response: { body: at("verify-failed.json") },
      expect: { status: "failed", amount: 6550, currency: "GHS", paidAt: null },
    },
    {
      name: "a cancelled checkout",
      ref: { reference: "RDN_FIXTURE003" },
      route: "GET /v3/transactions/verify_by_reference?tx_ref=RDN_FIXTURE003",
      response: { body: at("verify-cancelled.json") },
      expect: { status: "abandoned", amount: 6550, currency: "GHS" },
    },
    {
      name: "a transaction id that belongs to another reference",
      ref: { reference: "RDN_FIXTURE001", gatewayTransactionId: "1163068" },
      route: "GET /v3/transactions/1163068/verify",
      response: { body: at("verify-other-reference.json") },
      expect: null,
    },
    {
      name: "a reference Flutterwave doesn't know",
      ref: { reference: "RDN_UNKNOWN01" },
      route: "GET /v3/transactions/verify_by_reference?tx_ref=RDN_UNKNOWN01",
      response: { status: 404, body: at("verify-not-found.json") },
      expect: null,
    },
  ],
  webhook: {
    // Flutterwave sends back the secret hash you set, so the signature doesn't cover the body.
    signed: { rawBody: webhookBody, headers: { "verif-hash": HASH } },
    bodySigned: false,
    events: [
      {
        name: "charge.completed",
        body: JSON.parse(webhookBody),
        expect: {
          type: "charge.completed",
          reference: "RDN_FIXTURE001",
          metadata: { yaropay_product: "prd_fixture2" },
          payment: { status: "success", amount: 6550, fee: 92, currency: "GHS", channel: "mobile_money", gatewayTransactionId: "1163068" },
        },
      },
      { name: "an event YaroPay doesn't act on", body: { event: "transfer.completed", data: { reference: "TRF_1" } }, expect: { type: "transfer.completed", payment: null } },
    ],
  },
  callback: [
    { name: "a successful payment", query: { status: "successful", tx_ref: "RDN_FIXTURE001", transaction_id: "1163068" }, expect: { reference: "RDN_FIXTURE001", outcome: "successful", gatewayTransactionId: "1163068" } },
    { name: "a cancelled checkout", query: { status: "cancelled", tx_ref: "RDN_FIXTURE003" }, expect: { reference: "RDN_FIXTURE003", outcome: "cancelled" } },
    { name: "a failed payment", query: { status: "failed", tx_ref: "RDN_FIXTURE002" }, expect: { outcome: "failed" } },
  ],
  testConnection: { route: "GET /v3/balances", ok: { body: at("balances.json") } },
}))

describe("Flutterwave specifics", () => {
  it("maps payment types to channels", () => {
    expect(flutterwaveChannel("account")).toBe("bank")
    expect(flutterwaveChannel("mpesa")).toBe("mobile_money")
    expect(flutterwaveChannel("nqr")).toBe("qr")
    expect(flutterwaveChannel("barter")).toBeNull()
  })

  it("converts amounts with the currency's own decimal places", () => {
    // UGX has no minor unit, so UGX 5,000 is stored as 5000, not 500000.
    const ugx = flutterwaveAdapter.parseWebhook({ event: "charge.completed", data: { id: 1, tx_ref: "RDN_UGX1", amount: 5000, currency: "UGX", status: "successful", app_fee: 70 } })
    expect(ugx.payment).toMatchObject({ amount: 5000, fee: 70, currency: "UGX" })
  })
})
