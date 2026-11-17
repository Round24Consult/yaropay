import { describe, expect, it } from "vitest"
import { isValidPrefix, makeReference, PRODUCT_METADATA_KEY, resolveProduct, suggestPrefix } from "./routing.ts"

const products = [
  { id: "prd_a", referencePrefix: "SHW" },
  { id: "prd_b", referencePrefix: "LDG" },
]

describe("routing", () => {
  it("routes by metadata first", () => {
    expect(resolveProduct(products, "SHW_ABC", { [PRODUCT_METADATA_KEY]: "prd_b" })).toEqual({
      productId: "prd_b",
      matchedBy: "metadata",
    })
  })

  it("falls back to the reference prefix, case-insensitively", () => {
    expect(resolveProduct(products, "ldg_9F2K1C7Q", null)).toEqual({ productId: "prd_b", matchedBy: "prefix" })
  })

  it("ignores metadata naming an unknown product", () => {
    expect(resolveProduct(products, "SHW_1", { [PRODUCT_METADATA_KEY]: "prd_zzz" }).productId).toBe("prd_a")
  })

  it("marks unknown references as unrouted", () => {
    expect(resolveProduct(products, "T1234567", null)).toEqual({ productId: null, matchedBy: null })
    expect(resolveProduct(products, null, null).productId).toBeNull()
  })

  it("suggests unique valid prefixes", () => {
    expect(suggestPrefix("Shopwise")).toBe("SHP")
    expect(suggestPrefix("Ride Now")).toBe("RIN")
    const p = suggestPrefix("Shopwise", ["SHP", "SHO"])
    expect(isValidPrefix(p)).toBe(true)
    expect(["SHP", "SHO"]).not.toContain(p)
  })

  it("makes references with the prefix", () => {
    let i = 0
    const ref = makeReference("SHW", () => (i++ % 10) / 10)
    expect(ref).toMatch(/^SHW_[0-9A-Z]{10}$/)
  })
})
