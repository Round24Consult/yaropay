import type { GatewayDefinition } from "../types.ts"

/**
 * Monnify one-time payments (Monnify's hosted checkout). Written from Monnify's developer documentation
 * (developers.monnify.com) and its official SDKs (github.com/Monnify); see
 * apps/api/src/gateways/monnify/adapter.ts for the pages.
 */
export const monnify: GatewayDefinition<"monnify"> = {
  id: "monnify",
  name: "Monnify",
  tagline: "Bank transfer, cards and USSD in Nigeria",
  description:
    "Accept naira payments by bank transfer, card and USSD on Monnify's hosted checkout. YaroPay starts each transaction with the product's reference as the payment reference, so every Monnify notification can be traced back to the product that started it.",
  status: "beta",
  monogram: "MN",
  website: "https://monnify.com",
  docsUrl: "https://developers.monnify.com/docs/collections/one-time-payment",
  credentialFields: [
    {
      key: "apiKey",
      label: "API key",
      type: "text",
      required: true,
      placeholder: "MK_TEST_XXXXXXXXXX",
      prefix: { test: "MK_TEST_", live: "MK_PROD_" },
      minLength: 10,
      help: "From Developer, then API Keys & Contracts, in the Monnify dashboard.",
    },
    {
      key: "secretKey",
      label: "Secret key",
      type: "secret",
      required: true,
      placeholder: "XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
      minLength: 16,
      help: "Used server-side to sign in to Monnify's API and to check its notifications. Stored encrypted.",
    },
    {
      key: "contractCode",
      label: "Contract code",
      type: "text",
      required: true,
      placeholder: "1234567890",
      minLength: 4,
      help: "The contract that payments are collected under, shown next to the API keys.",
    },
  ],
  redirects: {
    callback: true,
    cancel: false,
    callbackField: "redirectUrl",
  },
  webhook: {
    signatureHeader: "monnify-signature",
    scheme: "HMAC-SHA512 of the raw body, keyed with the secret key",
    secretField: "secretKey",
    note: "Monnify signs its transaction notifications with your secret key, so no separate signing secret is needed.",
    endpointsPerAccount: "one",
  },
  currencies: ["NGN"],
  channels: ["bank_transfer", "card", "ussd"],
  dashboardSetupSteps: [
    "In the Monnify dashboard, open Developer, then Webhook URLs.",
    "Paste the webhook URL below as the Transaction Completion URL (and the Refund Completion URL if you refund from Monnify), then save.",
    "There is no redirect URL to set in Monnify: YaroPay gives Monnify the product's return URL with every transaction.",
  ],
  webhookIps: ["35.242.133.146"],
  api: { baseUrl: { test: "https://sandbox.monnify.com", live: "https://api.monnify.com" } },
}
