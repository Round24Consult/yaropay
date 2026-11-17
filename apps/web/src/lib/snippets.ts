import { API_KEY_PREFIX, SIGNATURE_TOLERANCE_SECONDS } from "@yaropay/core/payments"
import { PRODUCT_METADATA_KEY } from "@yaropay/core/routing"
import type { Mode } from "@yaropay/core/types"
import { PLATFORM_SIGNATURE_HEADER, productPaymentsEndpoint } from "@yaropay/core/urls"

/** Quick-start snippets shown on the Integration tab and after creating a product. */
export function createPaymentSnippets(opts: { baseUrl: string; productId: string; apiKey?: string; prefix: string; mode: Mode }) {
  const endpoint = productPaymentsEndpoint(opts.baseUrl, opts.productId)
  const keyPrefix = API_KEY_PREFIX[opts.mode]
  const key = opts.apiKey ?? "$YAROPAY_API_KEY"
  const curl = `# YAROPAY_API_KEY is this product's ${opts.mode} key (${keyPrefix}…).
# The key decides the mode: ${opts.mode} keys use your ${opts.mode} gateway accounts.
curl ${endpoint} \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: order-1042" \\
  -d '{
    "amount": 1500000,
    "currency": "NGN",
    "email": "customer@example.com",
    "gateway": "default",
    "metadata": { "orderId": "1042" }
  }'

# 201 Created
# {
#   "id": "txn_…",
#   "reference": "${opts.prefix}_9F2K1C7Q4M",
#   "status": "pending",
#   "gateway": "paystack",
#   "authorizationUrl": "https://checkout.paystack.com/…"
# }`

  const node = `// Server-side only: never expose your API key in the browser.
// YAROPAY_API_KEY is this product's ${opts.mode} key (${keyPrefix}…).
const res = await fetch("${endpoint}", {
  method: "POST",
  headers: {
    Authorization: \`Bearer \${process.env.YAROPAY_API_KEY}\`,
    "Content-Type": "application/json",
    // Retrying with the same key returns the same payment instead of a new one.
    "Idempotency-Key": \`order-\${order.id}\`,
  },
  body: JSON.stringify({
    amount: 1500000, // minor units: NGN 15,000.00
    currency: "NGN",
    email: customer.email,
    metadata: { orderId: order.id },
  }),
})
if (!res.ok) throw new Error((await res.json()).error.message)
const { reference, authorizationUrl } = await res.json()

// Save the reference on the order, then send the customer to checkout.
return redirect(authorizationUrl)`

  return { curl, node }
}

export function verifyWebhookSnippet() {
  return `import crypto from "node:crypto"

const TOLERANCE_SECONDS = ${SIGNATURE_TOLERANCE_SECONDS}

// YaroPay signs every event it forwards with your product's signing secret:
// ${PLATFORM_SIGNATURE_HEADER}: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">
export async function POST(req) {
  const raw = await req.text() // the raw body, before any JSON parsing
  const pairs = (req.headers.get("${PLATFORM_SIGNATURE_HEADER}") ?? "")
    .split(",")
    .map((part) => part.trim().split("="))
  const t = Number(pairs.find(([k]) => k === "t")?.[1])
  const signatures = pairs.filter(([k]) => k === "v1").map(([, v]) => v)

  // Old timestamps are rejected so a captured request cannot be replayed later.
  if (!t || Math.abs(Date.now() / 1000 - t) > TOLERANCE_SECONDS) {
    return new Response("stale or missing timestamp", { status: 400 })
  }

  const expected = crypto
    .createHmac("sha256", process.env.YAROPAY_SIGNING_SECRET)
    .update(\`\${t}.\${raw}\`)
    .digest("hex")
  const ok = signatures.some(
    (given) =>
      given.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected)),
  )
  if (!ok) return new Response("bad signature", { status: 401 })

  const event = JSON.parse(raw)
  // Deliveries can repeat (retries, replays): handle each event.id once.
  if (event.type === "payment.succeeded") {
    await markOrderPaid(event.data.metadata.orderId, event.data.reference)
  }
  return Response.json({ received: true })
}`
}

export function directModeSnippet(opts: { callbackUrl: string; productId: string; prefix: string }) {
  return `// Direct mode: you call Paystack yourself. Keep YaroPay in the loop by
// using its callback URL, a ${opts.prefix}_ reference and the product metadata.
await paystack.transaction.initialize({
  email: customer.email,
  amount: 1500000,
  reference: "${opts.prefix}_" + crypto.randomUUID().slice(0, 10).toUpperCase(),
  callback_url: "${opts.callbackUrl}",
  metadata: { ${PRODUCT_METADATA_KEY}: "${opts.productId}" },
})`
}
