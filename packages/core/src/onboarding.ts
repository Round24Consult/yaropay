import type { Permission } from "./auth.ts"

/**
 * The setup guide on the dashboard. Every step is worked out from real data
 * (sample data never counts), so it can't drift from what the install has.
 */
export type OnboardingStepId = "base_url" | "gateway" | "gateway_webhook" | "product" | "test_payment" | "product_webhook" | "team"

export interface OnboardingStepDefinition {
  id: OnboardingStepId
  title: string
  description: string
  /** Who can complete it. Members without it see the step but no action. */
  permission: Permission
  optional?: boolean
}

export const ONBOARDING_STEPS: OnboardingStepDefinition[] = [
  {
    id: "base_url",
    title: "Set your public URL",
    description:
      "Gateways send payment events to this address, so it has to be reachable from the internet. Every callback and webhook URL is built from it. In development, point a tunnel (ngrok, Cloudflare Tunnel) at the dashboard and paste its https URL.",
    permission: "settings:write",
  },
  {
    id: "gateway",
    title: "Connect a payment gateway",
    description: "Add your Paystack or Flutterwave keys once. Every product shares this account, and YaroPay keeps their payments apart.",
    permission: "gateways:write",
  },
  {
    id: "gateway_webhook",
    title: "Send gateway events to YaroPay",
    description:
      "Paste the gateway account's webhook URL into the gateway's dashboard. This step completes when the first correctly signed event arrives.",
    permission: "gateways:write",
  },
  {
    id: "product",
    title: "Add your first product",
    description: "Each website or app gets its own reference prefix, API keys, callback URLs and webhook endpoint.",
    permission: "products:write",
  },
  {
    id: "test_payment",
    title: "Take a test payment",
    description: "Create a payment with the product's test API key and pay with a gateway test card. This step completes when a payment succeeds.",
    permission: "products:write",
  },
  {
    id: "product_webhook",
    title: "Receive events in your product",
    description: "YaroPay forwards signed events to the product's webhook endpoint. Send a test event and return any 2xx response to complete this step.",
    permission: "products:write",
  },
  {
    id: "team",
    title: "Invite your team",
    description: "Give finance read-only access, give developers keys and webhooks, and limit anyone to the products they work on.",
    permission: "team:write",
    optional: true,
  },
]

export interface OnboardingStep {
  id: OnboardingStepId
  done: boolean
}

export interface SampleDataState {
  /** Sample products or gateway accounts are loaded. */
  present: boolean
  /** The install is empty (no products or gateway accounts), so sample data can be loaded. */
  canLoad: boolean
}

export interface OnboardingStatus {
  steps: OnboardingStep[]
  /** Required steps done / required steps. */
  completed: number
  total: number
  /** The current member hid the guide. */
  dismissed: boolean
  sampleData: SampleDataState
  /** First real gateway account and product, so the guide can link straight to them. */
  connectionId: string | null
  productId: string | null
}

export interface SampleDataRemoved {
  products: number
  connections: number
  transactions: number
}
