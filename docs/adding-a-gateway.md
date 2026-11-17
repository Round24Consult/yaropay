# Adding a gateway

Every payment gateway in YaroPay is Community code under the AGPL, free in every edition. A gateway is
two files and a set of recorded responses:

| File | What it is |
|---|---|
| `packages/core/src/gateways/<id>/definition.ts` | Plain data: name, credential fields, currencies, channels, how redirects and webhooks work, setup steps, API host. The Apps page, install form, product wizard, integration tab and the payment API's `gateway` field are generated from it. |
| `apps/api/src/gateways/<id>/adapter.ts` | The server adapter: starts payments, checks them, verifies and reads webhooks, reads the return URL, tests keys. |
| `apps/api/src/gateways/<id>/fixtures/*.json` | Responses recorded from the gateway's sandbox, used by `adapter.test.ts`. |

## Rule: official documentation only

Write the adapter from the gateway's own API documentation and sandbox. Don't copy code from other
products, plugins or scripts, even open-source ones, unless their licence allows it in an AGPL project
and you say so in the pull request. Everything you contribute is covered by the [CLA](../CLA.md).

## 1. Scaffold it

```bash
npm run gateway:new -- mpesa "M-Pesa"
```

`<id>` is lowercase letters, digits and underscores. It becomes the folder name, the API's `gateway`
value and the `<ID>_API_URL` override (`MPESA_API_URL`). The command creates the files below and
registers them in `packages/core/src/gateways/registry.ts` and `apps/api/src/gateways/adapters.ts`:

```
packages/core/src/gateways/mpesa/definition.ts
apps/api/src/gateways/mpesa/adapter.ts
apps/api/src/gateways/mpesa/adapter.test.ts
apps/api/src/gateways/mpesa/fixtures/README.md
```

For a gateway already listed as "coming soon" (Stripe, Monnify, Korapay), it keeps the existing definition
and adds the adapter. `npm run gateway:new -- mpesa --remove` undoes everything it created.

## 2. Fill in the definition

Replace every `TODO` in `definition.ts`. Points that matter:

- `credentialFields`: one per key the company pastes in. Mark secrets `type: "secret"` (they're encrypted
  and masked) and give test/live `prefix`es when the gateway's keys have them, so a test key can't go
  into a live account.
- `currencies`: ISO 4217 codes the gateway accepts. Amounts are always stored in the currency's minor
  units, with the decimal places in `packages/core/src/currencies.ts` (NGN 2, JPY 0, KWD 3).
- `api.baseUrl`: one URL, or `{ test, live }` when the sandbox has its own host.
- `redirects`, `webhook`, `dashboardSetupSteps`: what the company sees when connecting the account.
- `directModeExample` (optional): code for a product that calls the gateway itself.

Keep `status: "coming_soon"` until the adapter is done; it stays hidden from installs.

## 3. Write the adapter

`adapter.ts` implements `GatewayAdapter` from `apps/api/src/gateways/kit.ts`, which also has the helpers:
`gatewayRequest` (timeouts, Bearer or Basic auth, JSON or form bodies, errors turned into `GatewayError`),
`header`, `asRecord` and `asCurrency`, plus `toMinorUnits`/`toMajorUnits` in `@yaropay/core/currencies`.

| Method | Does |
|---|---|
| `initialize` | Creates the checkout with YaroPay's reference, callback URL and metadata. Returns the checkout URL, and the gateway's checkout id when it has one (a session, order or invoice). |
| `verify` | Asks the gateway where a payment stands. Returns `null` when the gateway doesn't know it. |
| `verifySignature` | Whether a webhook really came from the gateway. Async, so gateways that verify by API call can. |
| `parseWebhook`, `parseCallback` | Turn the gateway's webhook body and return-URL query into YaroPay's shapes. |
| `finalize` (optional) | Completes a payment the customer approved, for gateways where approval alone moves no money (PayPal's capture). Called on the customer's return, before `verify`. |
| `testConnection` | A cheap authenticated call, used by "Test connection" in the install form. |

Set `confirmsCancellation` to `true` only if the gateway reports a cancelled checkout distinctly from one
that is just unpaid.

## 4. Record fixtures and pass the contract tests

`adapter.test.ts` calls `describeGatewayContract` (`apps/api/src/gateways/testing/contract.ts`). It serves
your recorded responses from a fake API and checks, for every gateway:

- starting a checkout sends the right request (including the amount in the gateway's units) and returns
  the checkout URL;
- status checks map a successful, a failed and an abandoned payment, and an unknown reference gives `null`,
  with exact minor-unit amounts;
- a signed webhook is accepted, and a changed body or signature, or none, is refused;
- webhooks and return URLs are read correctly;
- "Test connection" passes with good keys and fails with rejected ones.

Record each response from the sandbox with your own test keys, remove keys, tokens and personal details,
and save the body in `fixtures/` (see the README there). `apps/api/src/gateways/paystack/adapter.test.ts`
is a complete example. Remove `pending: true` when the fixtures are in, and add tests for anything specific
to the gateway beside the contract.

## 5. Make it available and open a pull request

Set the definition's `status` to `"available"`. `apps/api/src/gateways/adapters.test.ts` then checks the
gateway has an adapter and everything the dashboard needs. Run `npm run typecheck`, `npm run lint` and
`npm test`, then open a pull request titled after the gateway ("M-Pesa gateway"); a maintainer adds the
`gateway` label so it's listed under "New gateways" in the release notes. Say in the description which
sandbox flows you tried by hand.
