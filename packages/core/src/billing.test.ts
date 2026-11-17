import { describe, expect, it } from "vitest"
import { addMonths, convertMinor, monthStart, periodKey, priceFor, type PriceSchedule, priceScheduleSchema, priceUsage, volumeFeeFor } from "./billing.ts"

const STANDARD: PriceSchedule = {
  perLiveProduct: { NGN: 1_500_000, USD: 1_000 },
  volumeFee: { enabled: false, rateBps: 0, threshold: { NGN: 0, USD: 0 }, cap: null },
}

const WITH_VOLUME: PriceSchedule = {
  ...STANDARD,
  // 0.5% of anything above NGN 10m (or USD 7,000) a month, at most NGN 500k (USD 350).
  volumeFee: { enabled: true, rateBps: 50, threshold: { NGN: 1_000_000_000, USD: 700_000 }, cap: { NGN: 50_000_000, USD: 35_000 } },
}

describe("billing", () => {
  it("converts through naira and rounds to the nearest minor unit", () => {
    const rates = { USD: "1550", GHS: "100.5" }
    expect(convertMinor(1_000, "USD", "NGN", rates)).toBe(1_550_000)
    expect(convertMinor(1_550_000, "NGN", "USD", rates)).toBe(1_000)
    expect(convertMinor(10_000, "GHS", "USD", rates)).toBe(648) // 100.50 GHS = 10,050 NGN = 6.48 USD
    expect(convertMinor(500, "NGN", "NGN", {})).toBe(500)
    expect(convertMinor(500, "KES", "NGN", rates)).toBeNull()
    expect(convertMinor(500, "USD", "NGN", { USD: "0" })).toBeNull()
  })

  it("charges the volume fee only above the threshold, up to the cap", () => {
    const fee = WITH_VOLUME.volumeFee
    expect(volumeFeeFor(fee, "NGN", 900_000_000)).toBe(0)
    expect(volumeFeeFor(fee, "NGN", 1_000_000_000)).toBe(0)
    expect(volumeFeeFor(fee, "NGN", 3_000_000_000)).toBe(10_000_000) // 0.5% of NGN 20m = NGN 100k
    expect(volumeFeeFor(fee, "NGN", 50_000_000_000)).toBe(50_000_000) // capped at NGN 500k
    expect(volumeFeeFor({ ...fee, cap: null }, "NGN", 50_000_000_000)).toBe(245_000_000)
    expect(volumeFeeFor({ ...fee, enabled: false }, "NGN", 50_000_000_000)).toBe(0)
  })

  it("prices a month: one line per live product, then the volume fee", () => {
    const usage = {
      liveProducts: [
        { id: "prd_b", name: "RideNow" },
        { id: "prd_a", name: "LedgerPro" },
      ],
      volume: [
        { currency: "NGN" as const, amount: 2_500_000_000, count: 120 },
        { currency: "USD" as const, amount: 400_000, count: 4 }, // USD 4,000 = NGN 6.2m
        { currency: "KES" as const, amount: 10_000, count: 1 },
      ],
    }
    const priced = priceUsage(WITH_VOLUME, "NGN", usage, { USD: "1550" })
    expect(priced.lines.map((l) => [l.description, l.amount])).toEqual([
      ["Live product: LedgerPro", 1_500_000],
      ["Live product: RideNow", 1_500_000],
      ["0.5% of live volume above the monthly threshold", 10_600_000], // 0.5% of (31.2m - 10m) = 106k
    ])
    expect(priced.volume).toBe(3_120_000_000)
    expect(priced.total).toBe(13_600_000)
    expect(priced.unconverted).toEqual(["KES"])

    const volumeOnly = priceUsage({ ...WITH_VOLUME, perLiveProduct: { NGN: 0, USD: 0 } }, "NGN", usage, { USD: "1550" })
    expect(volumeOnly.lines.map((l) => l.kind)).toEqual(["volume_fee"])

    const usd = priceUsage(STANDARD, "USD", { liveProducts: [{ id: "x", name: "X" }], volume: [] }, {})
    expect(usd).toMatchObject({ currency: "USD", total: 1_000, lines: [{ kind: "live_product", amount: 1_000 }] })
  })

  it("picks the price in effect at the start of the month, newest first", () => {
    const versions = [
      { id: "v1", effectiveFrom: "1970-01-01T00:00:00Z", createdAt: "2026-01-01T00:00:00Z" },
      { id: "v2", effectiveFrom: "2026-12-01T00:00:00Z", createdAt: "2026-11-10T00:00:00Z" },
      { id: "v3", effectiveFrom: "2026-11-01T00:00:00Z", createdAt: "2026-11-02T00:00:00Z" },
      { id: "v4", effectiveFrom: "2026-11-01T00:00:00Z", createdAt: "2026-11-05T00:00:00Z" },
    ]
    expect(priceFor(versions, new Date("2026-10-01T00:00:00Z"))?.id).toBe("v1")
    expect(priceFor(versions, new Date("2026-11-01T00:00:00Z"))?.id).toBe("v4")
    expect(priceFor(versions, new Date("2027-01-01T00:00:00Z"))?.id).toBe("v2")
    expect(priceFor([], new Date())).toBeNull()
  })

  it("works in UTC months across the year end", () => {
    const start = monthStart(new Date("2026-12-31T23:30:00-02:00")) // already January 1st in UTC
    expect(start.toISOString()).toBe("2027-01-01T00:00:00.000Z")
    expect(addMonths(new Date("2026-12-01T00:00:00Z"), 1).toISOString()).toBe("2027-01-01T00:00:00.000Z")
    expect(addMonths(new Date("2026-01-01T00:00:00Z"), -1).toISOString()).toBe("2025-12-01T00:00:00.000Z")
    expect(periodKey(new Date("2026-03-01T00:00:00Z"))).toBe("2026-03")
  })

  it("validates prices the super admin enters", () => {
    expect(priceScheduleSchema.safeParse(WITH_VOLUME).success).toBe(true)
    expect(priceScheduleSchema.safeParse({ ...STANDARD, perLiveProduct: { NGN: -1, USD: 1000 } }).success).toBe(false)
    expect(priceScheduleSchema.safeParse({ ...STANDARD, perLiveProduct: { NGN: 1.5, USD: 1000 } }).success).toBe(false)
    expect(priceScheduleSchema.safeParse({ ...WITH_VOLUME, volumeFee: { ...WITH_VOLUME.volumeFee, rateBps: 10_001 } }).success).toBe(false)
  })
})
