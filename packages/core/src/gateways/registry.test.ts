import { describe, expect, it } from "vitest"
import { isCurrencyCode } from "../currencies.ts"
import { AVAILABLE_GATEWAY_IDS, DEFAULT_GATEWAY_ID, GATEWAY_IDS, GATEWAYS, getGateway, isGatewayId, SUPPORTED_CURRENCIES } from "./registry.ts"
import { gatewayApiBaseUrl } from "./types.ts"

describe("gateway registry", () => {
  it("keys every definition by its own id, in the id format the API and env vars use", () => {
    for (const [key, def] of Object.entries(GATEWAYS)) {
      expect(def.id).toBe(key)
      expect(key).toMatch(/^[a-z][a-z0-9_]*$/)
    }
    expect(new Set(GATEWAY_IDS).size).toBe(GATEWAY_IDS.length)
  })

  it("only lists ISO 4217 currencies", () => {
    for (const def of Object.values(GATEWAYS)) for (const c of def.currencies) expect(isCurrencyCode(c), `${def.id}: ${c}`).toBe(true)
  })

  it("derives the supported currencies and the default gateway from the available gateways", () => {
    expect(SUPPORTED_CURRENCIES.slice(0, 2)).toEqual(["NGN", "USD"])
    expect(SUPPORTED_CURRENCIES).toEqual(expect.arrayContaining(["GHS", "KES", "ZAR"]))
    expect(AVAILABLE_GATEWAY_IDS).toContain(DEFAULT_GATEWAY_ID)
  })

  it("looks gateways up without trusting prototype keys", () => {
    expect(getGateway("paystack")?.name).toBe("Paystack")
    expect(getGateway("toString")).toBeUndefined()
    expect(isGatewayId("constructor")).toBe(false)
  })

  it("resolves the API host per mode", () => {
    expect(gatewayApiBaseUrl({ api: { baseUrl: "https://api.example.com/" } }, "live")).toBe("https://api.example.com")
    const split = { api: { baseUrl: { test: "https://sandbox.example.com", live: "https://api.example.com" } } }
    expect(gatewayApiBaseUrl(split, "test")).toBe("https://sandbox.example.com")
    expect(gatewayApiBaseUrl(split, "live")).toBe("https://api.example.com")
  })
})
