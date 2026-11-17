import type { GatewayApi, GatewayDefinition } from "./types.ts"

/**
 * A gateway that is listed in the dashboard as planned, before its adapter exists. Replace it with a full
 * definition (status "available") in the same pull request that adds the adapter.
 */
export function comingSoon<Id extends string>(g: {
  id: Id
  name: string
  monogram: string
  tagline: string
  website: string
  api: GatewayApi
}): GatewayDefinition<Id> {
  return {
    id: g.id,
    name: g.name,
    tagline: g.tagline,
    description: `${g.name} support is planned. Each gateway is a definition plus a server adapter, so contributions are welcome.`,
    status: "coming_soon",
    monogram: g.monogram,
    website: g.website,
    docsUrl: g.website,
    credentialFields: [],
    redirects: { callback: true, cancel: false, callbackField: "return_url" },
    webhook: { signatureHeader: "", scheme: "", secretField: "", note: "", endpointsPerAccount: "many" },
    currencies: [],
    channels: [],
    dashboardSetupSteps: [],
    api: g.api,
  }
}
