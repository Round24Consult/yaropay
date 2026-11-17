import type { CurrencyCode } from "../currencies.ts"
import { type GatewayDefinition, isInstallable } from "./types.ts"
// One folder per gateway. `npm run gateway:new` adds the import and the entry at the markers below.
import { flutterwave } from "./flutterwave/definition.ts"
import { korapay } from "./korapay/definition.ts"
import { monnify } from "./monnify/definition.ts"
import { paystack } from "./paystack/definition.ts"
import { stripe } from "./stripe/definition.ts"
// gateway:imports

/**
 * Every gateway YaroPay knows, keyed by id, in display order. Gateway connectors are plain data: the
 * install form, the setup guide, the product wizard and the payment API's `gateway` field are generated
 * from these definitions. Each available gateway also has a server adapter, listed in
 * apps/api/src/gateways/adapters.ts.
 */
export const GATEWAYS = {
  paystack,
  flutterwave,
  stripe,
  monnify,
  korapay,
  // gateway:entries
} as const satisfies Record<string, GatewayDefinition>

export type GatewayId = keyof typeof GATEWAYS

export const GATEWAY_IDS = Object.keys(GATEWAYS) as GatewayId[]

export const gatewayRegistry: GatewayDefinition<GatewayId>[] = Object.values(GATEWAYS)

/** Definitions of the gateways a company can install today: available or beta, in display order. */
export const installableGateways: GatewayDefinition<GatewayId>[] = gatewayRegistry.filter(isInstallable)

/** Gateways a company can install today: available or beta, not "coming soon". */
export const AVAILABLE_GATEWAY_IDS: GatewayId[] = installableGateways.map((g) => g.id)

/** The gateway that examples and previews use when there is nothing more specific. */
export const DEFAULT_GATEWAY_ID: GatewayId = gatewayRegistry.find((g) => g.status === "available")?.id ?? AVAILABLE_GATEWAY_IDS[0] ?? GATEWAY_IDS[0]

const FIRST_CURRENCIES: CurrencyCode[] = ["NGN", "USD"]

/** Currencies at least one installable gateway accepts: NGN and USD first, then alphabetical. */
export const SUPPORTED_CURRENCIES: CurrencyCode[] = [
  ...new Set(installableGateways.flatMap((g) => g.currencies)),
].sort((a, b) => {
  const ia = FIRST_CURRENCIES.indexOf(a)
  const ib = FIRST_CURRENCIES.indexOf(b)
  if (ia !== -1 || ib !== -1) return (ia === -1 ? Infinity : ia) - (ib === -1 ? Infinity : ib)
  return a.localeCompare(b)
})

export function isGatewayId(id: string): id is GatewayId {
  return Object.hasOwn(GATEWAYS, id)
}

export function getGateway(id: string): GatewayDefinition<GatewayId> | undefined {
  return isGatewayId(id) ? GATEWAYS[id] : undefined
}

export function requireGateway(id: string): GatewayDefinition<GatewayId> {
  const g = getGateway(id)
  if (!g) throw new Error(`Unknown gateway: ${id}`)
  return g
}
