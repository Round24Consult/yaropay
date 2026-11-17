import type { GatewayDefinition } from "../types.ts"

/**
 * PayPal Orders v2 (PayPal's hosted approval page). Written from PayPal's API documentation: Orders v2,
 * Payments v2 captures, OAuth client credentials, webhook verification and supported currencies
 * (see apps/api/src/gateways/paypal/adapter.ts for the pages).
 */
export const paypal: GatewayDefinition<"paypal"> = {
  id: "paypal",
  name: "PayPal",
  tagline: "PayPal balance, cards and Pay Later in 24 currencies",
  description:
    "Accept PayPal and cards on PayPal's hosted page. YaroPay creates an order for each payment with the product's reference, captures it once the customer approves, and ties every PayPal event back to the product that started it.",
  status: "beta",
  monogram: "PP",
  website: "https://www.paypal.com",
  docsUrl: "https://developer.paypal.com/docs/api/orders/v2/",
  credentialFields: [
    {
      key: "clientId",
      label: "Client ID",
      type: "text",
      required: true,
      placeholder: "AXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      minLength: 20,
      help: "Your app's client ID, from Apps & Credentials in the PayPal Developer Dashboard (Sandbox for test mode, Live for live mode).",
    },
    {
      key: "clientSecret",
      label: "Secret",
      type: "secret",
      required: true,
      placeholder: "EXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      minLength: 20,
      help: "The app's secret. Used server-side to get access tokens. Stored encrypted.",
    },
    {
      key: "webhookId",
      label: "Webhook ID",
      type: "text",
      required: false,
      placeholder: "8PT597110X687430LKGECATA",
      minLength: 10,
      help: "PayPal shows it once you add YaroPay's webhook URL to the app, so you can add it after installing. Until then YaroPay refuses PayPal's events.",
    },
  ],
  redirects: {
    callback: true,
    cancel: true,
    callbackField: "payment_source.paypal.experience_context.return_url",
    cancelField: "payment_source.paypal.experience_context.cancel_url",
  },
  webhook: {
    signatureHeader: "paypal-transmission-sig",
    scheme: "Checked with PayPal's verify-webhook-signature API, using the webhook ID",
    secretField: "webhookId",
    note: "PayPal signs every event with its certificate. YaroPay asks PayPal to confirm each signature, which needs this app's webhook ID.",
    endpointsPerAccount: "many",
  },
  // PayPal's supported currencies (https://developer.paypal.com/docs/reports/reference/paypal-supported-currencies/).
  // BRL, CNY and MYR work only for accounts in those countries.
  currencies: ["USD", "EUR", "GBP", "AUD", "BRL", "CAD", "CHF", "CNY", "CZK", "DKK", "HKD", "HUF", "ILS", "JPY", "MXN", "MYR", "NOK", "NZD", "PHP", "PLN", "SEK", "SGD", "THB", "TWD"],
  channels: ["card"],
  dashboardSetupSteps: [
    "In the PayPal Developer Dashboard, open Apps & Credentials (Sandbox for test mode, Live for live mode) and select your app.",
    "Under Webhooks, add a webhook with the URL below and subscribe to CHECKOUT.ORDER.APPROVED, PAYMENT.CAPTURE.COMPLETED, PAYMENT.CAPTURE.PENDING, PAYMENT.CAPTURE.DECLINED, PAYMENT.CAPTURE.DENIED, PAYMENT.CAPTURE.REFUNDED and PAYMENT.CAPTURE.REVERSED.",
    "Copy the webhook's ID and paste it into this account's Webhook ID in YaroPay.",
    "There is no return URL to set in PayPal: YaroPay sends the product's return and cancel URLs with every order.",
  ],
  api: { baseUrl: { test: "https://api-m.sandbox.paypal.com", live: "https://api-m.paypal.com" } },
}
