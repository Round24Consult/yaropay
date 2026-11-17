import { createHmac } from "node:crypto"
import { parseSignatureHeader } from "@yaropay/core/payments"
import { describe, expect, it } from "vitest"
import { describeAgent } from "../src/auth/auth.service.js"
import { hashPassword, verifyPassword } from "../src/auth/password.js"
import { scopeOf } from "../src/auth/scope.js"
import { decrypt, encrypt } from "../src/common/crypto.js"
import { isPrivateAddress } from "../src/common/ssrf.js"
import { loadConfig } from "../src/config/config.js"
import { flutterwaveAdapter, flutterwaveChannel } from "../src/gateways/adapters/flutterwave.js"
import { paystackAdapter } from "../src/gateways/adapters/paystack.js"
import { csvCell } from "../src/transactions/transactions.service.js"
import { signPayload } from "../src/webhooks/signing.js"

const KEY = Buffer.alloc(32, 7)

describe("encryption at rest", () => {
  it("round-trips and detects tampering", () => {
    const sealed = encrypt(KEY, "sk_live_secret")
    expect(sealed).not.toContain("sk_live")
    expect(decrypt(KEY, sealed)).toBe("sk_live_secret")
    const parts = sealed.split(".")
    parts[3] = Buffer.from("tampered").toString("base64url")
    expect(() => decrypt(KEY, parts.join("."))).toThrow()
    expect(() => decrypt(Buffer.alloc(32, 8), sealed)).toThrow()
  })
})

describe("passwords", () => {
  it("hashes with a per-hash salt and verifies", async () => {
    const a = await hashPassword("correct horse battery", "fast")
    const b = await hashPassword("correct horse battery", "fast")
    expect(a).not.toBe(b)
    expect(a.startsWith("scrypt$10$8$1$")).toBe(true)
    expect(await verifyPassword("correct horse battery", a)).toBe(true)
    expect(await verifyPassword("wrong", a)).toBe(false)
    expect(await verifyPassword("x", "bcrypt$whatever")).toBe(false)
  })
})

describe("product webhook signatures", () => {
  it("matches the documented t=,v1= scheme", () => {
    const header = signPayload("whsec_abc", '{"a":1}', 1_700_000_000)
    const parsed = parseSignatureHeader(header)!
    expect(parsed.t).toBe(1_700_000_000)
    expect(parsed.v1[0]).toBe(createHmac("sha256", "whsec_abc").update('1700000000.{"a":1}').digest("hex"))
    expect(parseSignatureHeader("garbage")).toBeNull()
  })
})

describe("gateway adapters", () => {
  it("verifies Paystack HMAC-SHA512 signatures over the raw body", () => {
    const raw = Buffer.from('{"event":"charge.success"}')
    const sig = createHmac("sha512", "sk_test_x").update(raw).digest("hex")
    expect(paystackAdapter.verifySignature({ secretKey: "sk_test_x" }, raw, { "x-paystack-signature": sig })).toBe(true)
    expect(paystackAdapter.verifySignature({ secretKey: "sk_test_x" }, Buffer.from('{"event":"charge.success" }'), { "x-paystack-signature": sig })).toBe(false)
    expect(paystackAdapter.verifySignature({ secretKey: "sk_test_x" }, raw, {})).toBe(false)
  })

  it("compares the Flutterwave verif-hash", () => {
    expect(flutterwaveAdapter.verifySignature({ secretHash: "h-123" }, Buffer.from("{}"), { "verif-hash": "h-123" })).toBe(true)
    expect(flutterwaveAdapter.verifySignature({ secretHash: "h-123" }, Buffer.from("{}"), { "verif-hash": "h-124" })).toBe(false)
    expect(flutterwaveAdapter.verifySignature({ secretHash: "" }, Buffer.from("{}"), { "verif-hash": "" })).toBe(false)
  })

  it("normalises webhook payloads and callback parameters", () => {
    const ps = paystackAdapter.parseWebhook({ event: "charge.success", data: { id: 1, reference: "SHW_1", amount: 5000, currency: "NGN", status: "success", channel: "ussd", fees: 75, metadata: '{"yaropay_product":"prd_1"}' } })
    expect(ps).toMatchObject({ type: "charge.success", reference: "SHW_1", metadata: { yaropay_product: "prd_1" }, payment: { status: "success", amount: 5000, channel: "ussd", fee: 75 } })
    const refund = paystackAdapter.parseWebhook({ event: "refund.processed", data: { transaction_reference: "SHW_1", amount: 5000, currency: "NGN" } })
    expect(refund.payment).toMatchObject({ status: "reversed", reference: "SHW_1" })
    const fw = flutterwaveAdapter.parseWebhook({ event: "charge.completed", data: { id: 9, tx_ref: "RDN_1", amount: 65.5, currency: "GHS", status: "successful", payment_type: "mobilemoneyghana", app_fee: 0.92 } })
    expect(fw.payment).toMatchObject({ amount: 6550, fee: 92, channel: "mobile_money", status: "success", gatewayTransactionId: "9" })
    expect(flutterwaveAdapter.parseCallback({ status: "cancelled", tx_ref: "RDN_1" })).toMatchObject({ outcome: "cancelled", reference: "RDN_1" })
    expect(paystackAdapter.parseCallback({ trxref: "SHW_1" })).toMatchObject({ reference: "SHW_1", outcome: null })
    expect(flutterwaveChannel("account")).toBe("bank")
  })
})

describe("guards and helpers", () => {
  it("recognises private addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "::1", "fd00::1", "::ffff:10.0.0.1", "0.0.0.0"]) {
      expect(isPrivateAddress(ip), ip).toBe(true)
    }
    for (const ip of ["8.8.8.8", "52.31.139.75", "2606:4700::1111"]) expect(isPrivateAddress(ip), ip).toBe(false)
  })

  it("narrows product filters to the member's scope, always inside their workspace", () => {
    const base = { id: "u", name: "n", email: "e", workspaceId: "wsp_a", role: "developer" as const, permissions: [], mfaEnabled: false, platformRole: null, createdAt: new Date() }
    expect(scopeOf({ ...base, productIds: null })).toEqual({ workspaceId: "wsp_a", productIds: "all" })
    expect(scopeOf({ ...base, productIds: null }, ["a"])).toEqual({ workspaceId: "wsp_a", productIds: ["a"] })
    expect(scopeOf({ ...base, productIds: ["a"] })).toEqual({ workspaceId: "wsp_a", productIds: ["a"] })
    expect(scopeOf({ ...base, productIds: ["a"] }, ["b"])).toEqual({ workspaceId: "wsp_a", productIds: [] })
  })

  it("defuses CSV formulas", () => {
    expect(csvCell("=SUM(A1)")).toBe(`"'=SUM(A1)"`)
    expect(csvCell("plain")).toBe("plain")
    expect(csvCell('say "hi", ok')).toBe('"say ""hi"", ok"')
  })

  it("describes user agents", () => {
    expect(describeAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0) AppleWebKit Safari/605")).toBe("Safari on macOS")
    expect(describeAgent(null)).toBe("an unknown device")
  })

  it("requires an encryption key in production", () => {
    expect(() => loadConfig({ NODE_ENV: "production" })).toThrow(/YAROPAY_ENCRYPTION_KEY/)
    expect(() => loadConfig({ NODE_ENV: "production", YAROPAY_ENCRYPTION_KEY: "short" })).toThrow(/32 bytes/)
    const ok = loadConfig({ NODE_ENV: "production", YAROPAY_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"), PASSWORD_HASH_COST: "fast" })
    expect(ok.passwordCost).toBe("standard")
    expect(ok.cookieSecure).toBe(true)
    expect(ok.webhookAllowPrivate).toBe(false)
  })
})
