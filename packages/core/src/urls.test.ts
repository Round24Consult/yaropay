import { describe, expect, it } from "vitest"
import {
  gatewayWebhookUrl,
  isHttpsUrl,
  normalizeBaseUrl,
  productCallbackUrl,
  productCancelUrl,
  productPaymentsEndpoint,
} from "./urls.ts"

describe("generated URLs", () => {
  it("normalises the base URL", () => {
    expect(normalizeBaseUrl("payments.company.com/")).toBe("https://payments.company.com")
    expect(normalizeBaseUrl(" http://localhost:3000// ")).toBe("http://localhost:3000")
  })

  it("builds one webhook URL per installed gateway account", () => {
    expect(gatewayWebhookUrl("https://pay.acme.ng", "paystack", "con_123")).toBe(
      "https://pay.acme.ng/v1/webhooks/paystack/con_123",
    )
  })

  it("builds per-product callback, cancel and payments URLs", () => {
    const base = "https://pay.acme.ng/"
    expect(productCallbackUrl(base, "prd_b", "flutterwave")).toBe(
      "https://pay.acme.ng/v1/callback/prd_b/flutterwave",
    )
    expect(productCancelUrl(base, "prd_b", "paystack")).toBe(
      "https://pay.acme.ng/v1/callback/prd_b/paystack?outcome=cancelled",
    )
    expect(productPaymentsEndpoint(base, "prd_b")).toBe("https://pay.acme.ng/v1/products/prd_b/payments")
  })

  it("follows a base URL change", () => {
    expect(productCallbackUrl("https://new.example.com", "prd_a", "paystack")).toContain("new.example.com")
  })

  it("detects https", () => {
    expect(isHttpsUrl("https://a.com/x")).toBe(true)
    expect(isHttpsUrl("http://a.com/x")).toBe(false)
    expect(isHttpsUrl("not a url")).toBe(false)
  })
})

describe("redirect targets", () => {
  it("accepts web URLs and app deep links, rejects script schemes", async () => {
    const { isRedirectTarget } = await import("./urls.ts")
    expect(isRedirectTarget("https://shop.ng/thanks")).toBe(true)
    expect(isRedirectTarget("ridenow://payment/success")).toBe(true)
    expect(isRedirectTarget("javascript://alert(1)")).toBe(false)
    expect(isRedirectTarget("shop.ng/thanks")).toBe(false)
  })
})
