import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { seedDemo } from "../src/demo/seed.js"
import { addMember, createTestApp, setupOwner, type TestApp } from "./helpers.js"

describe("dashboard data on the demo company", () => {
  let t: TestApp
  let owner: Awaited<ReturnType<typeof setupOwner>>["agent"]

  beforeAll(async () => {
    t = await createTestApp()
    owner = (await setupOwner(t)).agent
    await seedDemo(t.db, t.config)
  })
  afterAll(async () => {
    await t.close()
  })

  it("returns the overview contract with per-product slices that add up", async () => {
    const o = (await owner.get("/api/analytics/overview?period=30d").expect(200)).body
    expect(o.series).toHaveLength(30)
    expect(o.products.map((p: { productId: string }) => p.productId)).toEqual(["prd_shopwise", "prd_ledgerpro", "prd_ridenow"])
    const sliceTotal = o.products.reduce((s: number, p: { volume: number }) => s + p.volume, 0)
    expect(sliceTotal).toBe(o.kpis.grossVolume.current)
    const seriesTotal = o.series.reduce((s: number, b: { values: Record<string, number> }) => s + Object.values(b.values).reduce((a, v) => a + v, 0), 0)
    expect(seriesTotal).toBe(o.kpis.grossVolume.current)
    const gatewayTotal = o.gateways.reduce((s: number, g: { volume: number }) => s + g.volume, 0)
    expect(gatewayTotal).toBe(o.kpis.grossVolume.current)
    expect(o.kpis.grossVolume.trend.length).toBeLessThanOrEqual(24)
    expect(o.webhooks.unrouted).toBeGreaterThan(0)

    const monthly = (await owner.get("/api/analytics/overview?period=12m").expect(200)).body
    expect(monthly.query.granularity).toBe("month")
    expect(monthly.series).toHaveLength(12)
    const usd = (await owner.get("/api/analytics/overview?period=12m&currency=USD").expect(200)).body
    expect(usd.products.find((p: { productId: string }) => p.productId === "prd_ledgerpro").volume).toBeGreaterThan(0)
    expect(usd.products.find((p: { productId: string }) => p.productId === "prd_shopwise").volume).toBe(0)
  })

  it("filters transactions with facet counts that ignore their own dimension", async () => {
    const all = (await owner.get("/api/transactions?period=30d").expect(200)).body
    const ledger = (await owner.get("/api/transactions?period=30d&product=prd_ledgerpro").expect(200)).body
    expect(ledger.total).toBe(all.facets.products.prd_ledgerpro)
    expect(ledger.facets.products).toEqual(all.facets.products)
    expect(ledger.rows.every((r: { productId: string }) => r.productId === "prd_ledgerpro")).toBe(true)
    const success = (await owner.get("/api/transactions?period=30d&product=prd_ledgerpro&status=success&currency=NGN&sort=-amount").expect(200)).body
    expect(success.summary.currency).toBe("NGN")
    expect(success.rows[0].amount).toBeGreaterThanOrEqual(success.rows.at(-1).amount)
    const search = (await owner.get(`/api/transactions?q=${encodeURIComponent(all.rows[0].reference.toLowerCase())}`).expect(200)).body
    expect(search.rows[0].reference).toBe(all.rows[0].reference)
  })

  it("product cards carry 30-day stats; a scoped member sees only theirs", async () => {
    const products = (await owner.get("/api/products").expect(200)).body
    expect(products).toHaveLength(3)
    for (const p of products) {
      expect(p.stats.spark).toHaveLength(15)
      expect(p.stats.volume30d).toBeGreaterThan(0)
      expect(p.apiKeyPreview).toMatch(/^ypk_live_••••/)
      expect(p.testApiKeyPreview).toMatch(/^ypk_test_••••/)
    }
    const dev = await addMember(t, owner, { email: "ride@example.test", role: "developer", productIds: ["prd_ridenow"] })
    const o = (await dev.get("/api/analytics/overview?period=30d").expect(200)).body
    expect(o.products.map((p: { productId: string }) => p.productId)).toEqual(["prd_ridenow"])
    expect(o.webhooks.unrouted).toBe(0)
    const tx = (await dev.get("/api/transactions?period=30d").expect(200)).body
    expect(Object.keys(tx.facets.products)).toEqual(["prd_ridenow"])
    const deliveries = (await dev.get("/api/webhooks/deliveries").expect(200)).body
    expect(deliveries.rows.every((d: { productId: string }) => d.productId === "prd_ridenow")).toBe(true)
  })

  it("keeps payment history: products with live payments can only be paused", async () => {
    const res = await owner.delete("/api/products/prd_ridenow").expect(409)
    expect(res.body.error.message).toMatch(/Pause it instead/)
    const paused = await owner.patch("/api/products/prd_ridenow").send({ status: "paused" }).expect(200)
    expect(paused.body.status).toBe("paused")
  })
})
