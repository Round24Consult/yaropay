import type { CurrencyCode } from "../currencies.ts"
import type { Mode, PaymentChannel } from "../types.ts"

export interface CredentialField {
  key: string
  label: string
  /** `secret` fields are masked in the UI and never returned in full by the API. */
  type: "text" | "secret"
  required: boolean
  placeholder: string
  help?: string
  /**
   * Expected prefix per mode, e.g. `{ test: "sk_test_", live: "sk_live_" }`.
   * Used to catch test keys pasted into a live connection and vice versa.
   */
  prefix?: Partial<Record<Mode, string>>
  minLength?: number
}

export interface GatewayRedirects {
  /** The gateway sends the customer back to a per-transaction callback/redirect URL. */
  callback: boolean
  /** A separate URL is used when the customer cancels on the checkout page. */
  cancel: boolean
  /** How the cancel URL is passed, shown in setup notes. */
  cancelField?: string
  /** Query parameter the gateway appends that carries the outcome, if any. */
  statusParam?: string
  /** Name of the gateway's own field for the callback, shown in setup notes. */
  callbackField: string
}

export interface GatewayWebhook {
  signatureHeader: string
  scheme: string
  /** Credential key that holds the verification secret. */
  secretField: string
  note: string
  /** Webhook URLs accepted per account. Paystack and Flutterwave take one. */
  endpointsPerAccount: "one" | "many"
}

/** Where the gateway's server API lives. */
export interface GatewayApi {
  /**
   * Base URL of the gateway's API, without a trailing slash. Use `{ test, live }` when sandbox and live
   * accounts use different hosts. Operators can override it with `<ID>_API_URL` (for example
   * `PAYSTACK_API_URL`) to go through a proxy, or to point tests at a fake.
   */
  baseUrl: string | Record<Mode, string>
}

export interface GatewayDefinition<Id extends string = string> {
  /** Lowercase letters, digits and underscores; also the folder name and the `gateway` value in the API. */
  id: Id
  name: string
  tagline: string
  description: string
  status: "available" | "coming_soon"
  /** Brand-neutral monogram tile colours (we never ship third-party logos). */
  monogram: string
  website: string
  docsUrl: string
  credentialFields: CredentialField[]
  redirects: GatewayRedirects
  webhook: GatewayWebhook
  currencies: CurrencyCode[]
  channels: PaymentChannel[]
  /** Steps shown after install so the user can paste our URLs into the gateway dashboard. */
  dashboardSetupSteps: string[]
  /** Source IPs the platform may allow-list for incoming webhooks. */
  webhookIps?: string[]
  api: GatewayApi
  /**
   * Example shown on a product's Integration tab for "direct mode": the product calls the gateway itself
   * and keeps YaroPay in the loop through the callback URL, reference and metadata. Placeholders:
   * {{callbackUrl}}, {{prefix}}, {{productId}} and {{metadataKey}}. Leave it out when the gateway has no
   * such flow.
   */
  directModeExample?: string
}

/** The API base URL for an account in the given mode. */
export function gatewayApiBaseUrl(def: Pick<GatewayDefinition, "api">, mode: Mode): string {
  const url = typeof def.api.baseUrl === "string" ? def.api.baseUrl : def.api.baseUrl[mode]
  return url.replace(/\/+$/, "")
}
