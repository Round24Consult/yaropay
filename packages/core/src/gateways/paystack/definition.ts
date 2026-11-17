import type { GatewayDefinition } from "../types.ts"

export const paystack: GatewayDefinition<"paystack"> = {
  id: "paystack",
  name: "Paystack",
  tagline: "Cards, bank transfer, USSD and mobile money across Africa",
  description:
    "Accept payments in Nigeria, Ghana, Kenya and South Africa. YaroPay initialises each transaction with a product reference so every Paystack event can be traced back to the product that started it.",
  status: "available",
  monogram: "PS",
  website: "https://paystack.com",
  docsUrl: "https://paystack.com/docs/api/",
  credentialFields: [
    {
      key: "publicKey",
      label: "Public key",
      type: "text",
      required: true,
      placeholder: "pk_test_xxxxxxxxxxxxxxxxxxxxxxxx",
      prefix: { test: "pk_test_", live: "pk_live_" },
      minLength: 20,
      help: "Used by Paystack Inline and Popup on your product's checkout.",
    },
    {
      key: "secretKey",
      label: "Secret key",
      type: "secret",
      required: true,
      placeholder: "sk_test_xxxxxxxxxxxxxxxxxxxxxxxx",
      prefix: { test: "sk_test_", live: "sk_live_" },
      minLength: 20,
      help: "Used server-side to initialise and verify transactions. Stored encrypted.",
    },
  ],
  redirects: {
    callback: true,
    cancel: true,
    callbackField: "callback_url",
    cancelField: "metadata.cancel_action",
  },
  webhook: {
    signatureHeader: "x-paystack-signature",
    scheme: "HMAC-SHA512 of the raw body",
    secretField: "secretKey",
    note: "Paystack signs webhooks with your secret key, so no separate signing secret is needed.",
    endpointsPerAccount: "one",
  },
  currencies: ["NGN", "GHS", "KES", "ZAR", "USD"],
  channels: ["card", "bank_transfer", "ussd", "mobile_money", "bank", "qr"],
  dashboardSetupSteps: [
    "Open the Paystack Dashboard and go to Settings, then API Keys & Webhooks.",
    "Paste the webhook URL below into the Webhook URL field for this mode.",
    "Paste the callback URL into Callback URL. YaroPay sets a per-product callback on each transaction, so this is only a fallback.",
    "Save changes. Paystack sends a test event that will show up under Webhooks.",
  ],
  webhookIps: ["52.31.139.75", "52.49.173.169", "52.214.14.220"],
  api: { baseUrl: "https://api.paystack.co" },
  directModeExample: `// Direct mode: you call Paystack yourself. Keep YaroPay in the loop by
// using its callback URL, a {{prefix}}_ reference and the product metadata.
await paystack.transaction.initialize({
  email: customer.email,
  amount: 1500000,
  reference: "{{prefix}}_" + crypto.randomUUID().slice(0, 10).toUpperCase(),
  callback_url: "{{callbackUrl}}",
  metadata: { {{metadataKey}}: "{{productId}}" },
})`,
}
