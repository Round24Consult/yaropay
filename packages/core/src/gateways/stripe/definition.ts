import type { GatewayDefinition } from "../types.ts"

/**
 * Stripe Checkout (Stripe's hosted payment page). Written from Stripe's API reference:
 * https://docs.stripe.com/api/checkout/sessions, https://docs.stripe.com/currencies and
 * https://docs.stripe.com/webhooks (verifying signatures manually).
 */
export const stripe: GatewayDefinition<"stripe"> = {
  id: "stripe",
  name: "Stripe",
  tagline: "Cards, wallets and local payment methods in 130+ currencies",
  description:
    "Accept payments worldwide on Stripe's hosted Checkout page. YaroPay creates a Checkout Session for each payment with the product's reference, so every Stripe event can be traced back to the product that started it.",
  status: "beta",
  monogram: "ST",
  website: "https://stripe.com",
  docsUrl: "https://docs.stripe.com/api/checkout/sessions",
  credentialFields: [
    {
      key: "secretKey",
      label: "Secret key",
      type: "secret",
      required: true,
      placeholder: "sk_test_xxxxxxxxxxxxxxxxxxxxxxxx",
      prefix: { test: "sk_test_", live: "sk_live_" },
      minLength: 20,
      help: "Used server-side to create and check Checkout Sessions. Stored encrypted.",
    },
    {
      key: "webhookSecret",
      label: "Webhook signing secret",
      type: "secret",
      required: false,
      placeholder: "whsec_xxxxxxxxxxxxxxxxxxxxxxxx",
      prefix: { test: "whsec_", live: "whsec_" },
      minLength: 20,
      help: "Stripe shows it once you add YaroPay's webhook URL as an endpoint, so you can add it after installing. Until then YaroPay refuses Stripe's events.",
    },
  ],
  redirects: {
    callback: true,
    cancel: true,
    callbackField: "success_url",
    cancelField: "cancel_url",
  },
  webhook: {
    signatureHeader: "stripe-signature",
    scheme: "HMAC-SHA256 of the timestamp and the raw body, keyed with the endpoint's signing secret",
    secretField: "webhookSecret",
    note: "Each Stripe webhook endpoint has its own signing secret (whsec_...). Use the one for YaroPay's URL.",
    endpointsPerAccount: "many",
  },
  // Stripe's card presentment currencies (https://docs.stripe.com/currencies), as listed for US accounts.
  // Which ones an account can charge depends on its country.
  currencies: [
    "USD", "EUR", "GBP", "NGN", "AED", "AFN", "ALL", "AMD", "ANG", "AOA", "ARS", "AUD", "AWG", "AZN", "BAM", "BBD", "BDT", "BIF", "BMD",
    "BND", "BOB", "BRL", "BSD", "BWP", "BYN", "BZD", "CAD", "CDF", "CHF", "CLP", "CNY", "COP", "CRC", "CVE", "CZK", "DJF", "DKK", "DOP",
    "DZD", "EGP", "ETB", "FJD", "FKP", "GEL", "GIP", "GMD", "GNF", "GTQ", "GYD", "HKD", "HNL", "HTG", "HUF", "IDR", "ILS", "INR", "ISK",
    "JMD", "JPY", "KES", "KGS", "KHR", "KMF", "KRW", "KYD", "KZT", "LAK", "LBP", "LKR", "LRD", "LSL", "MAD", "MDL", "MGA", "MKD", "MMK",
    "MNT", "MOP", "MUR", "MVR", "MWK", "MXN", "MYR", "MZN", "NAD", "NIO", "NOK", "NPR", "NZD", "PAB", "PEN", "PGK", "PHP", "PKR", "PLN",
    "PYG", "QAR", "RON", "RSD", "RUB", "RWF", "SAR", "SBD", "SCR", "SEK", "SGD", "SHP", "SLE", "SOS", "SRD", "SZL", "THB", "TJS", "TOP",
    "TRY", "TTD", "TWD", "TZS", "UAH", "UGX", "UYU", "UZS", "VND", "VUV", "WST", "XAF", "XCD", "XCG", "XOF", "XPF", "YER", "ZAR", "ZMW",
  ],
  channels: ["card", "bank", "bank_transfer"],
  dashboardSetupSteps: [
    "In the Stripe Dashboard, open Developers, then Webhooks, and add an endpoint for your account's events.",
    "Paste the webhook URL below as the endpoint URL and choose these events: checkout.session.completed, checkout.session.async_payment_succeeded, checkout.session.async_payment_failed and checkout.session.expired.",
    "Reveal the endpoint's signing secret (it starts with whsec_) and paste it into this account's Webhook signing secret in YaroPay.",
    "There is no redirect URL to set in Stripe: YaroPay gives Stripe the product's return and cancel URLs with every payment.",
  ],
  api: { baseUrl: "https://api.stripe.com" },
}
