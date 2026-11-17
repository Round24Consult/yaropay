import { createHmac } from "node:crypto"
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { describeGatewayContract, fixture } from "../testing/contract.js"
import { fakeGateway } from "../testing/fake-gateway.js"
import { korapayAdapter, korapayStatus, toKorapayMetadata } from "./adapter.js"

const at = (name: string) => fixture(import.meta.url, `fixtures/${name}`)
const SECRET = "sk_test_fixture_not_a_real_key"
const credentials = { secretKey: SECRET }
const webhookBody = readFileSync(new URL("fixtures/webhook-charge-success.json", import.meta.url), "utf8").trim()
const callbackUrl = "https://pay.example.test/v1/callback/prd_fixture1/korapay"
/** Korapay signs only the data object, serialised with JSON.stringify. */
const signData = (raw: string) => createHmac("sha256", SECRET).update(JSON.stringify(JSON.parse(raw).data)).digest("hex")

describeGatewayContract(korapayAdapter, () => ({
  credentials,
  initialize: {
    params: {
      reference: "SHW_FIXTURE001",
      amount: 1500000,
      currency: "NGN",
      email: "kemi@example.com",
      name: "Kemi Adeyemi",
      callbackUrl,
      cancelUrl: null,
      metadata: { orderId: "1042", yaropay_product: "prd_fixture1" },
      channels: ["card", "bank_transfer", "bank"],
      title: "Shopwise",
    },
    route: "POST /api/v1/charges/initialize",
    response: { body: at("initialize.json") },
    // Korapay takes major units (naira).
    sends: {
      amount: 15000,
      currency: "NGN",
      reference: "SHW_FIXTURE001",
      redirect_url: callbackUrl,
      narration: "Shopwise",
      channels: ["card", "bank_transfer", "pay_with_bank"],
      customer: { email: "kemi@example.com", name: "Kemi Adeyemi" },
      metadata: { "yaropay-product": "prd_fixture1", orderId: "1042" },
    },
    returns: { authorizationUrl: "https://checkout.korapay.com/SHW_FIXTURE001/pay" },
  },
  verify: [
    {
      name: "a successful card payment",
      ref: { reference: "SHW_FIXTURE001" },
      route: "GET /api/v1/charges/SHW_FIXTURE001",
      response: { body: at("verify-success.json") },
      expect: { status: "success", amount: 1500000, currency: "NGN", fee: 16125, channel: "card", metadata: { yaropay_product: "prd_fixture1" } },
    },
    {
      name: "a declined card",
      ref: { reference: "SHW_FIXTURE002" },
      route: "GET /api/v1/charges/SHW_FIXTURE002",
      response: { body: at("verify-failed.json") },
      expect: { status: "failed", amount: 1500000, currency: "NGN", fee: 0, paidAt: null, channel: "card", message: expect.stringContaining("not allowed") as unknown as string },
    },
    {
      name: "a checkout that expired unpaid",
      ref: { reference: "SHW_FIXTURE003" },
      route: "GET /api/v1/charges/SHW_FIXTURE003",
      response: { body: at("verify-abandoned.json") },
      expect: { status: "abandoned", amount: 1500000, currency: "NGN", paidAt: null },
    },
    {
      name: "a reference Korapay doesn't know",
      ref: { reference: "SHW_UNKNOWN01" },
      route: "GET /api/v1/charges/SHW_UNKNOWN01",
      response: { status: 404, body: at("verify-not-found.json") },
      expect: null,
    },
  ],
  webhook: {
    signed: { rawBody: webhookBody, headers: { "x-korapay-signature": signData(webhookBody) } },
    events: [
      {
        name: "charge.success",
        body: JSON.parse(webhookBody),
        expect: {
          type: "charge.success",
          reference: "SHW_FIXTURE001",
          metadata: { yaropay_product: "prd_fixture1" },
          payment: { status: "success", amount: 1500000, currency: "NGN", fee: 16125, channel: "bank_transfer", paidAt: "2026-11-17T12:04:11.000Z" },
        },
      },
      {
        name: "charge.failed (mobile money in Kenya)",
        body: at("webhook-charge-failed.json"),
        expect: { type: "charge.failed", reference: "SHW_FIXTURE002", payment: { status: "failed", amount: 100000, currency: "KES", channel: "mobile_money" } },
      },
      {
        name: "refund.success points at the payment, not the refund",
        body: at("webhook-refund-success.json"),
        expect: { type: "refund.success", reference: "SHW_FIXTURE001", payment: { status: "reversed", amount: 1500000 } },
      },
      { name: "an event YaroPay doesn't act on", body: { event: "transfer.success", data: { reference: "TRF_1" } }, expect: { type: "transfer.success", payment: null } },
    ],
  },
  callback: [{ name: "back from checkout", query: { reference: "SHW_FIXTURE001" }, expect: { reference: "SHW_FIXTURE001", outcome: null } }],
  testConnection: { route: "GET /api/v1/balances", ok: { body: at("balances.json") } },
}))

describe("Korapay specifics", () => {
  it("maps Korapay's charge statuses", () => {
    expect(korapayStatus("success")).toBe("success")
    expect(korapayStatus("failed")).toBe("failed")
    expect(korapayStatus("processing")).toBe("pending")
    expect(korapayStatus("expired")).toBe("abandoned")
  })

  it("fits metadata into Korapay's 5 keys of 20 safe characters, YaroPay's routing key first", () => {
    const m = toKorapayMetadata({ a: "1", b: "2", c: { nested: true }, d: "4", e: "5", yaropay_product: "prd_1", "a key with spaces that is far too long": "x" })
    expect(Object.keys(m ?? {})).toEqual(["yaropay-product", "a", "b", "c", "d"])
    expect(m?.c).toBe('{"nested":true}')
    expect(toKorapayMetadata({})).toBeUndefined()
  })

  it("checks the signature over the data object, so a changed amount is refused", async () => {
    const gw = fakeGateway({})
    const forged = webhookBody.replace('"amount":15000', '"amount":150000')
    expect(await korapayAdapter.verifySignature(gw.ctx, credentials, Buffer.from(forged), { "x-korapay-signature": signData(webhookBody) })).toBe(false)
    // Formatting outside the data object doesn't matter: Korapay signs the data object itself.
    const pretty = JSON.stringify(JSON.parse(webhookBody), null, 2)
    expect(await korapayAdapter.verifySignature(gw.ctx, credentials, Buffer.from(pretty), { "x-korapay-signature": signData(webhookBody) })).toBe(true)
  })

  it("reads an unknown reference reported with an error status as not found", async () => {
    const gw = fakeGateway({ "GET /api/v1/charges/SHW_UNKNOWN01": { status: 400, body: at("verify-not-found.json") } })
    expect(await korapayAdapter.verify(gw.ctx, credentials, { reference: "SHW_UNKNOWN01" })).toBeNull()
  })
})
