import { describe, expect, it } from "vitest"
import { OPERATOR_SETTING_INFO, OPERATOR_SETTINGS, operatorSettingValueSchemas } from "./platform.ts"

const ok = (key: keyof typeof operatorSettingValueSchemas, value: unknown) => operatorSettingValueSchemas[key].safeParse(value).success

describe("operator settings", () => {
  it("describes every setting, and only the billing key and SMTP URL are secret", () => {
    expect(Object.keys(OPERATOR_SETTING_INFO)).toEqual([...OPERATOR_SETTINGS])
    expect(OPERATOR_SETTINGS.filter((k) => OPERATOR_SETTING_INFO[k].secret)).toEqual(["billingPaystackSecretKey", "smtpUrl"])
  })

  it("accepts only Paystack secret keys for billing", () => {
    expect(ok("billingPaystackSecretKey", "sk_test_0123456789abcdef0123456789abcdef01234567")).toBe(true)
    expect(ok("billingPaystackSecretKey", "  sk_live_0123456789abcdef0123  ")).toBe(true)
    expect(ok("billingPaystackSecretKey", "pk_live_0123456789abcdef0123")).toBe(false)
    expect(ok("billingPaystackSecretKey", "sk_test_short")).toBe(false)
  })

  it("accepts smtp:// and smtps:// URLs only", () => {
    expect(ok("smtpUrl", "smtp://user:pass@in-v3.mailjet.com:587")).toBe(true)
    expect(ok("smtpUrl", "smtps://user:pass@smtp.example.com:465")).toBe(true)
    expect(ok("smtpUrl", "https://smtp.example.com")).toBe(false)
    expect(ok("smtpUrl", "smtp.example.com")).toBe(false)
  })

  it("accepts a plain or named sender address", () => {
    expect(ok("mailFrom", "no-reply@yaropay.com")).toBe(true)
    expect(ok("mailFrom", "YaroPay <no-reply@yaropay.com>")).toBe(true)
    expect(ok("mailFrom", "YaroPay")).toBe(false)
  })

  it("accepts a whole-number limit from 1 to 1,000,000", () => {
    expect(operatorSettingValueSchemas.v1RateLimitPerMinute.parse("600")).toBe(600)
    expect(ok("v1RateLimitPerMinute", 0)).toBe(false)
    expect(ok("v1RateLimitPerMinute", 2.5)).toBe(false)
    expect(ok("v1RateLimitPerMinute", 1_000_001)).toBe(false)
  })
})
