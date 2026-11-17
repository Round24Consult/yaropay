# PayPal fixtures

These responses are built from the schemas and examples in PayPal's official OpenAPI files
(https://github.com/paypal/paypal-rest-api-specifications: checkout_orders_v2.json and
notifications_webhooks_v1.json) and the webhook event pages, not yet recorded from a live sandbox, which is
why PayPal is marked beta. Replace each with a real sandbox response (secrets, names and emails removed)
when you record one.

- `token.json`: `POST /v1/oauth2/token` (client credentials).
- `initialize.json`: a new order (`POST /v2/checkout/orders`) with its payer-action link.
- `verify-*.json`: an order (`GET /v2/checkout/orders/{id}`) in each state YaroPay maps.
- `capture.json`: the capture call's minimal answer; `capture-resource.json`: `GET /v2/payments/captures/{id}`.
- `webhook-*.json`: event bodies for the events YaroPay subscribes to.
