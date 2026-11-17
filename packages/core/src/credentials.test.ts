import { describe, expect, it } from "vitest"
import { buildCredentialSchema, maskCredentials, maskSecret } from "./gateways/credentials.ts"
import { flutterwave } from "./gateways/flutterwave/definition.ts"
import { paystack } from "./gateways/paystack/definition.ts"
import { gatewayRegistry } from "./gateways/registry.ts"

describe("credential schema", () => {
  it("accepts test keys in test mode", () => {
    const schema = buildCredentialSchema(paystack, "test")
    const r = schema.safeParse({ publicKey: "pk_test_1234567890abcdef1234", secretKey: "sk_test_1234567890abcdef1234" })
    expect(r.success).toBe(true)
  })

  it("rejects test keys in live mode with a clear message", () => {
    const schema = buildCredentialSchema(paystack, "live")
    const r = schema.safeParse({ publicKey: "pk_test_1234567890abcdef1234", secretKey: "sk_test_1234567890abcdef1234" })
    expect(r.success).toBe(false)
    expect(r.error?.issues.map((i) => i.message).join(" ")).toContain("sk_live_")
  })

  it("requires every Flutterwave field including the webhook secret hash", () => {
    const r = buildCredentialSchema(flutterwave, "test").safeParse({})
    expect(r.success).toBe(false)
    const keys = new Set(r.error?.issues.map((i) => i.path[0]))
    expect(keys).toEqual(new Set(["publicKey", "secretKey", "encryptionKey", "secretHash"]))
  })

  it("masks secrets but keeps public keys", () => {
    expect(maskSecret("sk_live_abcdef1234")).toBe("sk_live_••••••••1234")
    const masked = maskCredentials(paystack, { publicKey: "pk_test_abc", secretKey: "sk_test_zzzz9999" })
    expect(masked.publicKey).toBe("pk_test_abc")
    expect(masked.secretKey).not.toContain("zzzz")
  })

  it("only lists coming-soon gateways without fields", () => {
    for (const g of gatewayRegistry) {
      if (g.status === "coming_soon") expect(g.credentialFields).toHaveLength(0)
      else expect(g.credentialFields.length).toBeGreaterThan(0)
    }
  })
})
