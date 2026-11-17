import { describe, expect, it } from "vitest"
import { CURRENCY_CODES, currencyInfo, isCurrencyCode, minorUnitExponent, toMajorUnits, toMinorUnits } from "./currencies.ts"
import { formatMoney } from "./money.ts"

describe("currencies", () => {
  it("knows each currency's decimal places", () => {
    expect(minorUnitExponent("NGN")).toBe(2)
    expect(minorUnitExponent("JPY")).toBe(0)
    expect(minorUnitExponent("UGX")).toBe(0)
    expect(minorUnitExponent("XOF")).toBe(0)
    expect(minorUnitExponent("KWD")).toBe(3)
    expect(currencyInfo("GHS")).toEqual({ code: "GHS", name: "Ghanaian cedi", exponent: 2 })
    expect(CURRENCY_CODES.every((c) => /^[A-Z]{3}$/.test(c))).toBe(true)
  })

  it("converts between minor and major units with those decimal places", () => {
    expect(toMinorUnits(65.5, "GHS")).toBe(6550)
    expect(toMinorUnits(0.92, "GHS")).toBe(92)
    expect(toMinorUnits(1500, "JPY")).toBe(1500)
    expect(toMinorUnits(1.5, "KWD")).toBe(1500)
    expect(toMajorUnits(1500000, "NGN")).toBe(15000)
    expect(toMajorUnits(1500, "JPY")).toBe(1500)
    expect(toMajorUnits(1500, "KWD")).toBe(1.5)
  })

  it("only accepts real codes", () => {
    expect(isCurrencyCode("NGN")).toBe(true)
    expect(isCurrencyCode("ngn")).toBe(false)
    expect(isCurrencyCode("XYZ")).toBe(false)
    expect(isCurrencyCode("toString")).toBe(false)
  })

  it("formats amounts with the currency's decimal places", () => {
    expect(formatMoney(1500000, "NGN")).toBe("₦15,000.00")
    expect(formatMoney(1500, "JPY")).toBe("¥1,500")
    expect(formatMoney(1500, "KWD")).toMatch(/1\.500$/)
  })
})
