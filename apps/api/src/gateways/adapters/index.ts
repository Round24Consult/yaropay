import type { GatewayId } from "@yaropay/core/types"
import { flutterwaveAdapter } from "./flutterwave.js"
import { paystackAdapter } from "./paystack.js"
import type { GatewayAdapter } from "./types.js"

const ADAPTERS: Partial<Record<GatewayId, GatewayAdapter>> = {
  paystack: paystackAdapter,
  flutterwave: flutterwaveAdapter,
}

export function adapterFor(id: string): GatewayAdapter | null {
  return ADAPTERS[id as GatewayId] ?? null
}
