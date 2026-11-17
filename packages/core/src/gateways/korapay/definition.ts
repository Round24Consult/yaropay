import type { GatewayDefinition } from "../types.ts"

/**
 * Korapay Checkout Redirect (Korapay's hosted checkout). Written from Korapay's developer documentation
 * (developers.korapay.com); see apps/api/src/gateways/korapay/adapter.ts for the pages.
 */
export const korapay: GatewayDefinition<"korapay"> = {
  id: "korapay",
  name: "Korapay",
  tagline: "Cards, bank transfer and mobile money across Africa",
  description:
    "Accept payments in Nigeria, Kenya, Ghana and other African markets on Korapay's hosted checkout. YaroPay starts each charge with the product's reference, so every Korapay notification can be traced back to the product that started it.",
  status: "beta",
  monogram: "KP",
  website: "https://korapay.com",
  docsUrl: "https://developers.korapay.com/docs/checkout-redirect",
  credentialFields: [
    {
      key: "secretKey",
      label: "Secret key",
      type: "secret",
      required: true,
      placeholder: "sk_test_xxxxxxxxxxxxxxxxxxxxxxxx",
      prefix: { test: "sk_test_", live: "sk_live_" },
      minLength: 20,
      help: "From Settings, then API Configuration, in the Korapay dashboard. Used server-side to start and verify charges, and to check notifications. Stored encrypted.",
    },
  ],
  redirects: {
    callback: true,
    cancel: false,
    callbackField: "redirect_url",
  },
  webhook: {
    signatureHeader: "x-korapay-signature",
    scheme: "HMAC-SHA256 of the payload's data object, keyed with the secret key",
    secretField: "secretKey",
    note: "Korapay signs its notifications with your secret key, so no separate signing secret is needed.",
    endpointsPerAccount: "one",
  },
  // Checkout and card currencies, plus the mobile money currencies Korapay documents.
  currencies: ["NGN", "KES", "GHS", "USD", "XAF", "XOF", "TZS", "EGP"],
  channels: ["card", "bank_transfer", "mobile_money", "bank"],
  dashboardSetupSteps: [
    "In the Korapay dashboard, open Settings, then API Configuration.",
    "Paste the webhook URL below as the Notification URL and save.",
    "There is no redirect URL to set in Korapay: YaroPay gives Korapay the product's return URL with every charge.",
  ],
  api: { baseUrl: "https://api.korapay.com/merchant" },
}
