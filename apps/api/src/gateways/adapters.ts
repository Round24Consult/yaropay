import type { GatewayId } from "@yaropay/core/types"
import type { GatewayAdapter } from "./kit.js"
// One folder per gateway. `npm run gateway:new` adds the import and the entry at the markers below.
import { flutterwaveAdapter } from "./flutterwave/adapter.js"
import { paystackAdapter } from "./paystack/adapter.js"
import { stripeAdapter } from "./stripe/adapter.js"
import { paypalAdapter } from "./paypal/adapter.js"
import { monnifyAdapter } from "./monnify/adapter.js"
import { korapayAdapter } from "./korapay/adapter.js"
// gateway:imports

/**
 * Server adapters by gateway id. Every gateway marked "available" or "beta" in the registry
 * (packages/core/src/gateways/registry.ts) needs one; adapters.test.ts checks that.
 */
export const ADAPTERS: Partial<Record<GatewayId, GatewayAdapter>> = {
  paystack: paystackAdapter,
  flutterwave: flutterwaveAdapter,
  stripe: stripeAdapter,
  paypal: paypalAdapter,
  monnify: monnifyAdapter,
  korapay: korapayAdapter,
  // gateway:entries
}

export function adapterFor(id: string): GatewayAdapter | null {
  return ADAPTERS[id as GatewayId] ?? null
}
