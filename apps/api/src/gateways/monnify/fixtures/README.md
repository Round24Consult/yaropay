# Monnify fixtures

These responses are built from the response shapes in Monnify's official SDKs and their documentation
(github.com/Monnify: the Node library README, the Java SDK's transaction and webhook models, the PHP SDK's
webhook payload tests), not yet recorded from a live sandbox, which is why Monnify is marked beta. Replace
each with a real sandbox response (secrets, names and emails removed) when you record one.

Unconfirmed until then: the exact `paymentStatus` value for a checkout the customer never paid (the fixture
uses `EXPIRED`; the adapter also reads `ABANDONED` and `CANCELLED`), the format of `paidOn`, and the error
status Monnify answers for an unknown payment reference.

- `login.json`: `POST /api/v1/auth/login`.
- `initialize.json`: `POST /api/v1/merchant/transactions/init-transaction`.
- `verify-*.json`: `GET /api/v2/merchant/transactions/query?paymentReference=...`.
- `webhook-*.json`: notification bodies (`eventType`, `eventData`).
