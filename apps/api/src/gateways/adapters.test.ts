import { GATEWAYS, gatewayRegistry } from "@yaropay/core/gateways/registry"
import { gatewayApiBaseUrl, isInstallable } from "@yaropay/core/gateways/types"
import { describe, expect, it } from "vitest"
import { ADAPTERS } from "./adapters.js"

describe("gateway registry and adapters", () => {
  it("has a server adapter for every installable gateway", () => {
    // A planned ("coming soon") gateway may already have an adapter while it's being built; it stays
    // hidden from installs until its definition says "beta" or "available".
    for (const g of gatewayRegistry.filter(isInstallable)) {
      expect(ADAPTERS[g.id], `${g.id} can be installed but has no adapter in adapters.ts`).toBeDefined()
    }
  })

  it("registers each adapter under its own gateway id", () => {
    for (const [id, adapter] of Object.entries(ADAPTERS)) {
      expect(adapter?.id).toBe(id)
      expect(adapter?.name).toBe(GATEWAYS[id as keyof typeof GATEWAYS].name)
    }
  })

  it("gives every installable gateway what the dashboard and the API need", () => {
    for (const g of gatewayRegistry.filter(isInstallable)) {
      expect(g.credentialFields.length, `${g.id}: credential fields`).toBeGreaterThan(0)
      expect(g.currencies.length, `${g.id}: currencies`).toBeGreaterThan(0)
      expect(g.channels.length, `${g.id}: channels`).toBeGreaterThan(0)
      expect(g.dashboardSetupSteps.length, `${g.id}: setup steps`).toBeGreaterThan(0)
      expect(g.credentialFields.some((f) => f.key === g.webhook.secretField) || g.webhook.secretField === "", `${g.id}: webhook.secretField must name a credential field`).toBe(true)
      for (const mode of ["test", "live"] as const) expect(gatewayApiBaseUrl(g, mode)).toMatch(/^https:\/\/[^/]+/)
    }
  })
})
