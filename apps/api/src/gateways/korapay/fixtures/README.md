# Korapay fixtures

These responses are built from the examples in Korapay's documentation (Checkout Redirect, Accept Card
Payments with APIs, Webhooks), not yet recorded from a live sandbox, which is why Korapay is marked beta.
Replace each with a real sandbox response (secrets, names and emails removed) when you record one.

Unconfirmed until then: the status value of a checkout left unpaid (the fixture uses `expired`; the adapter
also reads `abandoned` and `cancelled`), whether `transaction_date` is UTC, and the status Korapay answers
for an unknown reference.

- `initialize.json`: `POST /api/v1/charges/initialize`.
- `verify-*.json`: `GET /api/v1/charges/{reference}`.
- `webhook-*.json`: notification bodies. Korapay signs `JSON.stringify(body.data)`.
- `balances.json`: `GET /api/v1/balances`, used by "Test connection".
