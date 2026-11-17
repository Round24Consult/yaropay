import type { GatewayId } from "../types.ts"
import type { GatewayDefinition } from "./types.ts"

/**
 * Gateway connectors are plain data. The install form, the setup guide and the
 * product wizard are all generated from these definitions, so adding a gateway
 * means adding an entry here (and a server-side adapter in the backend).
 */
export const paystack: GatewayDefinition = {
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
}

export const flutterwave: GatewayDefinition = {
  id: "flutterwave",
  name: "Flutterwave",
  tagline: "Pan-African payments with cards, mobile money and bank transfer",
  description:
    "Accept payments in over 30 currencies. YaroPay sets the redirect URL and tx_ref per product and reads the status Flutterwave appends to decide where to send the customer.",
  status: "available",
  monogram: "FW",
  website: "https://flutterwave.com",
  docsUrl: "https://developer.flutterwave.com/docs",
  credentialFields: [
    {
      key: "publicKey",
      label: "Public key",
      type: "text",
      required: true,
      placeholder: "FLWPUBK_TEST-xxxxxxxxxxxxxxxx-X",
      prefix: { test: "FLWPUBK_TEST-", live: "FLWPUBK-" },
      minLength: 20,
    },
    {
      key: "secretKey",
      label: "Secret key",
      type: "secret",
      required: true,
      placeholder: "FLWSECK_TEST-xxxxxxxxxxxxxxxx-X",
      prefix: { test: "FLWSECK_TEST-", live: "FLWSECK-" },
      minLength: 20,
    },
    {
      key: "encryptionKey",
      label: "Encryption key",
      type: "secret",
      required: true,
      placeholder: "From Settings > API keys",
      minLength: 12,
      help: "Needed for direct card charges.",
    },
    {
      key: "secretHash",
      label: "Webhook secret hash",
      type: "secret",
      required: true,
      placeholder: "A long random string",
      minLength: 16,
      help: "Enter the same value in Flutterwave under Settings, then Webhooks. It comes back in the verif-hash header.",
    },
  ],
  redirects: {
    callback: true,
    cancel: false,
    callbackField: "redirect_url",
    statusParam: "status",
  },
  webhook: {
    signatureHeader: "verif-hash",
    scheme: "Shared secret hash, compared in constant time",
    secretField: "secretHash",
    note: "Flutterwave sends your secret hash in the verif-hash header. Events without a matching hash are rejected.",
    endpointsPerAccount: "one",
  },
  currencies: ["NGN", "USD", "GHS", "KES", "ZAR"],
  channels: ["card", "bank_transfer", "ussd", "mobile_money"],
  dashboardSetupSteps: [
    "Open the Flutterwave Dashboard and go to Settings, then Webhooks.",
    "Paste the webhook URL below into the URL field.",
    "Enter the same secret hash you saved here.",
    "Save. Cancelled and failed payments come back through the per-product callback with status=cancelled or status=failed.",
  ],
}

const comingSoon = (
  id: GatewayId,
  name: string,
  monogram: string,
  tagline: string,
  website: string,
): GatewayDefinition => ({
  id,
  name,
  tagline,
  description: `${name} support is planned. Connectors are plain definitions plus a server adapter, so contributions are welcome.`,
  status: "coming_soon",
  monogram,
  website,
  docsUrl: website,
  credentialFields: [],
  redirects: { callback: true, cancel: false, callbackField: "return_url" },
  webhook: {
    signatureHeader: "",
    scheme: "",
    secretField: "",
    note: "",
    endpointsPerAccount: "many",
  },
  currencies: [],
  channels: [],
  dashboardSetupSteps: [],
})

export const gatewayRegistry: GatewayDefinition[] = [
  paystack,
  flutterwave,
  comingSoon("stripe", "Stripe", "ST", "Global cards, wallets and local methods", "https://stripe.com"),
  comingSoon("monnify", "Monnify", "MN", "Reserved accounts and bank transfers in Nigeria", "https://monnify.com"),
  comingSoon("korapay", "Korapay", "KP", "Collections and payouts across Africa", "https://korapay.com"),
]

export function getGateway(id: string): GatewayDefinition | undefined {
  return gatewayRegistry.find((g) => g.id === id)
}

export function requireGateway(id: string): GatewayDefinition {
  const g = getGateway(id)
  if (!g) throw new Error(`Unknown gateway: ${id}`)
  return g
}
