#!/usr/bin/env node
// Scaffolds a payment gateway: the definition (dashboard and API data), the server adapter, its contract
// test and a fixtures folder, and registers them. See CONTRIBUTING.md, "Adding a gateway".
//
//   npm run gateway:new -- <id> "<Display name>"   create
//   npm run gateway:new -- <id> --remove           undo: delete what this created and unregister it
//
// <id> is lowercase letters, digits and underscores (it becomes the folder name, the API's `gateway`
// value and the <ID>_API_URL variable). Only uses Node built-ins.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const MARK = "Scaffolded by `npm run gateway:new`"
const CORE_REGISTRY = join(ROOT, "packages/core/src/gateways/registry.ts")
const API_ADAPTERS = join(ROOT, "apps/api/src/gateways/adapters.ts")

function fail(message) {
  console.error(message)
  process.exit(1)
}

const [id, nameOrFlag] = process.argv.slice(2)
if (!id || !/^[a-z][a-z0-9_]{1,31}$/.test(id)) {
  fail('Usage: npm run gateway:new -- <id> "<Display name>"   (id: lowercase letters, digits and underscores)\n       npm run gateway:new -- <id> --remove')
}
const remove = nameOrFlag === "--remove"
const name = remove ? "" : (nameOrFlag ?? "").trim()
if (!remove && !name) fail(`Give the gateway's display name too: npm run gateway:new -- ${id} "Display Name"`)

const camel = id.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase())
const coreDir = join(ROOT, "packages/core/src/gateways", id)
const apiDir = join(ROOT, "apps/api/src/gateways", id)
const definitionFile = join(coreDir, "definition.ts")

const lines = {
  coreImport: `import { ${camel} } from "./${id}/definition.ts"`,
  coreEntry: id === camel ? `  ${id},` : `  ${id}: ${camel},`,
  apiImport: `import { ${camel}Adapter } from "./${id}/adapter.js"`,
  apiEntry: `  ${id}: ${camel}Adapter,`,
}

/** Inserts a line before a marker comment, once. */
function insertBefore(file, marker, line) {
  const text = readFileSync(file, "utf8")
  if (text.split("\n").includes(line)) return
  if (!text.includes(marker)) fail(`${file} has lost its "${marker.trim()}" marker`)
  writeFileSync(file, text.replace(marker, `${line}\n${marker}`))
}

function removeLine(file, line) {
  const text = readFileSync(file, "utf8")
  writeFileSync(file, text.split("\n").filter((l) => l !== line).join("\n"))
}

if (remove) {
  if (existsSync(definitionFile) && readFileSync(definitionFile, "utf8").includes(MARK)) {
    rmSync(coreDir, { recursive: true, force: true })
    removeLine(CORE_REGISTRY, lines.coreImport)
    removeLine(CORE_REGISTRY, lines.coreEntry)
  }
  rmSync(apiDir, { recursive: true, force: true })
  removeLine(API_ADAPTERS, lines.apiImport)
  removeLine(API_ADAPTERS, lines.apiEntry)
  console.log(`Removed the ${id} scaffold.`)
  process.exit(0)
}

if (existsSync(apiDir)) fail(`apps/api/src/gateways/${id} already exists.`)

const monogram = name.replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase() || id.slice(0, 2).toUpperCase()

const definition = `// ${MARK}. Fill in every TODO from ${name}'s official documentation, then set status to
// "available" once apps/api/src/gateways/${id}/adapter.test.ts passes without \`pending\`.
import type { GatewayDefinition } from "../types.ts"

export const ${camel}: GatewayDefinition<"${id}"> = {
  id: "${id}",
  name: ${JSON.stringify(name)},
  tagline: "TODO: one line, e.g. Cards and mobile money in Kenya",
  description: "TODO: two sentences on what ${name} offers and how YaroPay ties each payment to the product that started it.",
  status: "coming_soon",
  monogram: ${JSON.stringify(monogram)},
  website: "https://TODO.example",
  docsUrl: "https://TODO.example/docs",
  credentialFields: [
    {
      key: "secretKey",
      label: "Secret key",
      type: "secret",
      required: true,
      placeholder: "TODO",
      help: "Used server-side to start and verify payments. Stored encrypted.",
    },
  ],
  redirects: { callback: true, cancel: false, callbackField: "TODO: ${name}'s name for the return URL" },
  webhook: {
    signatureHeader: "TODO",
    scheme: "TODO: how ${name} signs webhooks",
    secretField: "secretKey",
    note: "TODO",
    endpointsPerAccount: "one",
  },
  currencies: ["USD"],
  channels: ["card"],
  dashboardSetupSteps: ["TODO: where to paste YaroPay's webhook URL in the ${name} dashboard."],
  api: { baseUrl: "https://TODO.example" },
}
`

const adapter = `// ${MARK}. Write each method from ${name}'s official API documentation, record sandbox
// responses into ./fixtures and make ./adapter.test.ts pass without \`pending: true\`.
import { type GatewayAdapter, GatewayError, gatewayRequest } from "../kit.js"

const NAME = ${JSON.stringify(name)}
const todo = (what: string) => new GatewayError(\`\${NAME}: \${what} isn't implemented yet\`, "request")

export const ${camel}Adapter: GatewayAdapter = {
  id: "${id}",
  name: NAME,
  confirmsCancellation: false,

  async initialize(_ctx, _creds, _params) {
    throw todo("starting a payment")
  },

  async verify(_ctx, _creds, _ref) {
    throw todo("checking a payment")
  },

  async verifySignature(_ctx, _creds, _rawBody, _headers) {
    return false
  },

  parseWebhook(_body) {
    return { type: "unknown", reference: null, payment: null, metadata: {} }
  },

  parseCallback(query) {
    return { reference: query.reference ?? null, outcome: null, gatewayTransactionId: null }
  },

  async testConnection(ctx, creds) {
    try {
      await gatewayRequest(ctx, NAME, "/TODO", { secret: creds.secretKey })
      return { ok: true, message: \`\${NAME} accepted the secret key.\` }
    } catch (e) {
      return { ok: false, message: (e as Error).message }
    }
  },
}
`

const test = `import { describeGatewayContract } from "../testing/contract.js"
import { ${camel}Adapter } from "./adapter.js"

// Record responses from the ${name} sandbox into ./fixtures (see fixtures/README.md), fill in the cases
// below, then delete \`pending: true\`. ../paystack/adapter.test.ts is a complete example.
describeGatewayContract(
  ${camel}Adapter,
  () => ({
    credentials: { secretKey: "TODO_fixture_key" },
    initialize: {
      params: {
        reference: "ABC_FIXTURE001",
        amount: 150000,
        currency: "USD",
        email: "customer@example.com",
        callbackUrl: "https://pay.example.test/v1/callback/prd_fixture/${id}",
        cancelUrl: null,
        metadata: { yaropay_product: "prd_fixture" },
        title: "Example product",
      },
      route: "POST /TODO",
      response: { body: {} },
      sends: {},
      returns: { authorizationUrl: "https://TODO.example/checkout" },
    },
    verify: [],
    webhook: { signed: { rawBody: "{}", headers: {} }, events: [] },
    callback: [],
    testConnection: { route: "GET /TODO", ok: { body: {} } },
  }),
  { pending: true },
)
`

const fixturesReadme = `# ${name} fixtures

Responses recorded from the ${name} sandbox, one JSON file per response, used by ../adapter.test.ts.

1. Make the request in the sandbox (with your own test keys) and save the response body here, for
   example \`verify-success.json\`.
2. Remove anything secret or personal: keys, tokens, real names, emails and phone numbers. Use the
   placeholders the other gateways' fixtures use (kemi@example.com, ABC_FIXTURE001...).
3. Load it in the test with \`fixture(import.meta.url, "fixtures/verify-success.json")\`.

Cover at least: starting a checkout, a successful, a failed and an abandoned payment, a reference the
gateway doesn't know, a signed webhook, and the balance (or similar) call used to test keys.
`

const createdDefinition = !existsSync(definitionFile)
if (createdDefinition) {
  mkdirSync(coreDir, { recursive: true })
  writeFileSync(definitionFile, definition)
  insertBefore(CORE_REGISTRY, "// gateway:imports", lines.coreImport)
  insertBefore(CORE_REGISTRY, "  // gateway:entries", lines.coreEntry)
}
mkdirSync(join(apiDir, "fixtures"), { recursive: true })
writeFileSync(join(apiDir, "adapter.ts"), adapter)
writeFileSync(join(apiDir, "adapter.test.ts"), test)
writeFileSync(join(apiDir, "fixtures/README.md"), fixturesReadme)
insertBefore(API_ADAPTERS, "// gateway:imports", lines.apiImport)
insertBefore(API_ADAPTERS, "  // gateway:entries", lines.apiEntry)

console.log(`Scaffolded ${name} (${id}):`)
if (createdDefinition) console.log(`  packages/core/src/gateways/${id}/definition.ts   what the dashboard and API show`)
else console.log(`  packages/core/src/gateways/${id}/definition.ts   (kept the existing definition)`)
console.log(`  apps/api/src/gateways/${id}/adapter.ts          the server adapter`)
console.log(`  apps/api/src/gateways/${id}/adapter.test.ts     the shared contract tests (pending)`)
console.log(`  apps/api/src/gateways/${id}/fixtures/           recorded sandbox responses`)
console.log("Next: fill in the TODOs, record fixtures, remove `pending: true`, then set the definition's status to \"available\".")
