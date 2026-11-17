import { describe, expect, it } from "vitest"
import { buckets, defaultGranularity, resolvePeriod } from "./analytics.ts"
import { delta, formatMoney, formatPercent } from "./money.ts"

describe("money", () => {
  it("formats minor units", () => {
    expect(formatMoney(1_500_000, "NGN")).toBe("₦15,000.00")
    expect(formatMoney(123_456_789, "USD", { compact: true })).toBe("$1.2M")
  })
  it("computes deltas and percents", () => {
    expect(delta(150, 100)).toBeCloseTo(0.5)
    expect(delta(5, 0)).toBeNull()
    expect(formatPercent(0.9734)).toBe("97.3%")
  })
})

describe("periods and buckets", () => {
  const now = new Date("2026-11-15T10:00:00Z")
  it("resolves 7d inclusive of today", () => {
    const { from, to } = resolvePeriod("7d", now)
    expect(from).toBe("2026-11-09T00:00:00.000Z")
    expect(to).toBe("2026-11-15T23:59:59.999Z")
    expect(buckets(from, to, "day")).toHaveLength(7)
  })
  it("picks granularity by range length", () => {
    const r = resolvePeriod("12m", now)
    expect(defaultGranularity(r.from, r.to)).toBe("month")
    expect(buckets(r.from, r.to, "month")).toHaveLength(12)
  })
})
