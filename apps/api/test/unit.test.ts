import { createHmac } from "node:crypto"
import { parseSignatureHeader } from "@yaropay/core/payments"
import { describe, expect, it } from "vitest"
import { describeAgent } from "../src/auth/auth.service.js"
import { hashPassword, verifyPassword } from "../src/auth/password.js"
import { scopeOf } from "../src/auth/scope.js"
import { decrypt, encrypt } from "../src/common/crypto.js"
import { isPrivateAddress } from "../src/common/ssrf.js"
import { loadConfig } from "../src/config/config.js"
import { ConnectionsService } from "../src/gateways/connections.service.js"
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

// Gateway adapters have their own tests next to them: src/gateways/<id>/adapter.test.ts.

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

  it("lets operators point any gateway at another API host with <ID>_API_URL", () => {
    const defaults = loadConfig({ NODE_ENV: "test" })
    expect(defaults.gateways.apiUrls).toEqual({})
    expect(defaults.gateways.paystackUrl).toBe("https://api.paystack.co")
    const proxied = loadConfig({ NODE_ENV: "test", PAYSTACK_API_URL: "https://proxy.example.test/paystack/", MONNIFY_API_URL: "https://monnify.proxy.test" })
    expect(proxied.gateways.apiUrls).toEqual({ paystack: "https://proxy.example.test/paystack", monnify: "https://monnify.proxy.test" })
    expect(proxied.gateways.paystackUrl).toBe("https://proxy.example.test/paystack")
    expect(() => loadConfig({ NODE_ENV: "test", FLUTTERWAVE_API_URL: "not a url" })).toThrow(/FLUTTERWAVE_API_URL must be a URL/)
  })

  it("gives adapters the API host for the account's mode, unless the operator overrode it", () => {
    const service = (env: Record<string, string>) => new ConnectionsService({} as never, fetch, loadConfig({ NODE_ENV: "test", ...env }), {} as never, {} as never, {} as never)
    expect(service({}).context({ gatewayId: "monnify", mode: "test" })).toMatchObject({ baseUrl: "https://sandbox.monnify.com", mode: "test" })
    expect(service({}).context({ gatewayId: "monnify", mode: "live" }).baseUrl).toBe("https://api.monnify.com")
    expect(service({}).context({ gatewayId: "paystack", mode: "live" }).baseUrl).toBe("https://api.paystack.co")
    expect(service({ MONNIFY_API_URL: "https://monnify.proxy.test" }).context({ gatewayId: "monnify", mode: "live" }).baseUrl).toBe("https://monnify.proxy.test")
  })
})
