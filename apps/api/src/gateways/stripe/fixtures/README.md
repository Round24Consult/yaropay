# Stripe fixtures

These responses are built from the examples and object reference in Stripe's API documentation
(https://docs.stripe.com/api/checkout/sessions/object, https://docs.stripe.com/api/events), not yet
recorded from a live sandbox, which is why Stripe is marked beta. Replace each with a real sandbox response
(secrets, names and emails removed) when you record one.

- `initialize.json`: a new Checkout Session (`POST /v1/checkout/sessions`).
- `verify-*.json`: a session retrieved with `expand[]=payment_intent.latest_charge.balance_transaction`.
- `webhook-*.json`: event bodies for the checkout.session events YaroPay subscribes to.
- `balance.json`: `GET /v1/balance`, used by "Test connection".
