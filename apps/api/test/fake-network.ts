/**
 * Stands in for the internet during tests: a small Paystack, a small
 * Flutterwave v3, a small PayPal (Orders v2), product webhook endpoints and alert webhooks. Every request
 * is recorded so tests can assert what YaroPay actually sent.
 */

export interface RecordedRequest {
  url: string
  method: string
  headers: Record<string, string>
  body: string
}

interface FakePayment {
  reference: string
  amount: number
  currency: string
  status: string
  metadata: Record<string, unknown>
  email: string
  id: number
  channel: string
}

interface FakePayPalOrder {
  id: string
  customId: string
  amount: { currency_code: string; value: string }
  status: "PAYER_ACTION_REQUIRED" | "APPROVED" | "COMPLETED" | "VOIDED"
  captureId: string | null
}

/** Client credentials the fake PayPal accepts, and the transmission signature its webhook check calls valid. */
export const PAYPAL_FAKE = { clientId: "AXtestClientId0123456789abcdefgh", clientSecret: "EXtestSecret0123456789abcdefghij", webhookId: "WH_TEST_ID_0001", validSignature: "fake-valid-signature" }

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

export class FakeNetwork {
  readonly requests: RecordedRequest[] = []
  /** Paystack and Flutterwave payments by reference. */
  readonly payments = new Map<string, FakePayment>()
  /** Status code each product endpoint answers with (default 200). */
  readonly endpointStatus = new Map<string, number>()
  /** Secret keys the fake gateways accept. */
  readonly validKeys = new Set<string>(["sk_test_1234567890abcdefghij", "FLWSECK_TEST-1234567890abcdef-X"])
  private nextId = 4_000_000_000
  /** Paystack charge_authorization answers "failed" while this is set (a declined saved card). */
  declineCharges: string | null = null
  /** Paystack refunds asked for, by transaction reference. */
  readonly refunds: string[] = []
  /** PayPal orders by id. */
  readonly paypalOrders = new Map<string, FakePayPalOrder>()
  /** Hosts that never answer, like a hung server: a request waits until the caller's timeout gives up. */
  readonly silentHosts = new Set<string>()
  /** JSON documents served at exact addresses (an AI app's client ID metadata document, for one). */
  readonly documents = new Map<string, { status?: number; body: unknown; headers?: Record<string, string> }>()
  private nextOrder = 1

  fetch = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url)
    const headers: Record<string, string> = {}
    new Headers(init.headers).forEach((v, k) => {
      headers[k] = v
    })
    const body = typeof init.body === "string" ? init.body : ""
    const method = (init.method ?? "GET").toUpperCase()
    this.requests.push({ url: url.href, method, headers, body })
    if (this.silentHosts.has(url.host)) return never(init.signal)

    const doc = this.documents.get(url.href)
    if (doc) return new Response(JSON.stringify(doc.body), { status: doc.status ?? 200, headers: { "content-type": "application/json", ...doc.headers } })
    if (url.host === "api.paystack.test") return this.paystack(url, method, headers, body)
    if (url.host === "api.flutterwave.test") return this.flutterwave(url, method, headers, body)
    if (url.host === "api.paypal.test") return this.paypal(url, method, headers, body)
    const status = this.endpointStatus.get(url.origin + url.pathname) ?? this.endpointStatus.get(url.origin) ?? 200
    if (status === 0) throw new TypeError("fetch failed")
    return json(status, status < 300 ? { received: true } : { error: "nope" })
  }

  /** The customer approves a PayPal order on PayPal's page. */
  approvePayPal(orderId: string) {
    const order = this.paypalOrders.get(orderId)
    if (!order) throw new Error(`No fake PayPal order ${orderId}`)
    order.status = "APPROVED"
  }

  /** Requests sent to a URL prefix. */
  sentTo(prefix: string) {
    return this.requests.filter((r) => r.url.startsWith(prefix))
  }

  setStatus(reference: string, status: string, patch: Partial<FakePayment> = {}) {
    const p = this.payments.get(reference)
    if (!p) throw new Error(`No fake payment ${reference}`)
    Object.assign(p, { status, ...patch })
  }

  /** A payment the product started directly with the gateway (direct mode). */
  addDirectPayment(p: Omit<FakePayment, "id" | "channel"> & { channel?: string }) {
    const payment = { id: this.nextId++, channel: "card", ...p }
    this.payments.set(p.reference, payment)
    return payment
  }

  private authed(headers: Record<string, string>) {
    const key = (headers.authorization ?? "").replace(/^Bearer /, "")
    return this.validKeys.has(key)
  }

  private paystack(url: URL, method: string, headers: Record<string, string>, body: string): Response {
    if (!this.authed(headers)) return json(401, { status: false, message: "Invalid key" })
    if (method === "POST" && url.pathname === "/transaction/initialize") {
      const b = JSON.parse(body)
      this.payments.set(b.reference, {
        reference: b.reference,
        amount: b.amount,
        currency: b.currency,
        status: "ongoing",
        metadata: b.metadata,
        email: b.email,
        id: this.nextId++,
        channel: "card",
      })
      return json(200, { status: true, message: "Authorization URL created", data: { authorization_url: `https://checkout.paystack.test/${b.reference}`, access_code: "ac_123", reference: b.reference } })
    }
    const verify = /^\/transaction\/verify\/(.+)$/.exec(url.pathname)
    if (method === "GET" && verify) {
      const p = this.payments.get(decodeURIComponent(verify[1]))
      if (!p) return json(404, { status: false, message: "Transaction reference not found" })
      return json(200, {
        status: true,
        message: "Verification successful",
        data: {
          id: p.id,
          status: p.status,
          reference: p.reference,
          amount: p.amount,
          currency: p.currency,
          channel: p.channel,
          fees: Math.round(p.amount * 0.015),
          paid_at: p.status === "success" ? new Date().toISOString() : null,
          gateway_response: p.status === "success" ? "Approved" : "Declined",
          customer: { email: p.email, first_name: "Kemi", last_name: "Adeyemi" },
          metadata: p.metadata,
          // A card payment that succeeded leaves a reusable authorization behind.
          authorization:
            p.status === "success"
              ? { authorization_code: `AUTH_${p.reference}`, reusable: true, last4: "4081", exp_month: "12", exp_year: "2030", card_type: "visa ", bank: "TEST BANK", signature: "SIG_test_card", channel: "card" }
              : null,
        },
      })
    }
    if (method === "POST" && url.pathname === "/transaction/charge_authorization") {
      const b = JSON.parse(body)
      const ok = this.declineCharges === null && String(b.authorization_code).startsWith("AUTH_")
      this.payments.set(b.reference, { reference: b.reference, amount: b.amount, currency: b.currency, status: ok ? "success" : "failed", metadata: b.metadata ?? {}, email: b.email, id: this.nextId++, channel: "card" })
      return json(200, {
        status: true,
        message: "Charge attempted",
        data: { reference: b.reference, amount: b.amount, currency: b.currency, status: ok ? "success" : "failed", gateway_response: ok ? "Approved" : (this.declineCharges ?? "Declined") },
      })
    }
    if (method === "POST" && url.pathname === "/refund") {
      const b = JSON.parse(body)
      this.refunds.push(String(b.transaction))
      return json(200, { status: true, message: "Refund has been queued for processing", data: { status: "pending", transaction: { reference: b.transaction } } })
    }
    if (method === "GET" && url.pathname === "/balance") return json(200, { status: true, data: [{ currency: "NGN", balance: 0 }] })
    return json(404, { status: false, message: "Not found" })
  }

  private flutterwave(url: URL, method: string, headers: Record<string, string>, body: string): Response {
    if (!this.authed(headers)) return json(401, { status: "error", message: "Invalid authorization key" })
    if (method === "POST" && url.pathname === "/v3/payments") {
      const b = JSON.parse(body)
      this.payments.set(b.tx_ref, {
        reference: b.tx_ref,
        amount: Math.round(b.amount * 100),
        currency: b.currency,
        status: "pending",
        metadata: b.meta,
        email: b.customer.email,
        id: this.nextId++,
        channel: "mobilemoneyghana",
      })
      return json(200, { status: "success", message: "Hosted Link", data: { link: `https://checkout.flutterwave.test/${b.tx_ref}` } })
    }
    const byId = /^\/v3\/transactions\/(\d+)\/verify$/.exec(url.pathname)
    const byRef = url.pathname === "/v3/transactions/verify_by_reference" ? url.searchParams.get("tx_ref") : null
    if (method === "GET" && (byId || byRef)) {
      const p = byId ? [...this.payments.values()].find((x) => String(x.id) === byId[1]) : this.payments.get(byRef!)
      if (!p) return json(404, { status: "error", message: "No transaction was found", data: null })
      return json(200, {
        status: "success",
        message: "Transaction fetched successfully",
        data: {
          id: p.id,
          tx_ref: p.reference,
          amount: p.amount / 100,
          currency: p.currency,
          status: p.status,
          payment_type: p.channel,
          app_fee: (p.amount / 100) * 0.014,
          created_at: new Date().toISOString(),
          customer: { email: p.email, name: "Kofi Mensah" },
          meta: p.metadata,
        },
      })
    }
    if (method === "GET" && url.pathname === "/v3/balances") return json(200, { status: "success", data: [] })
    return json(404, { status: "error", message: "Not found" })
  }

  private paypalOrderJson(o: FakePayPalOrder) {
    const unit: Record<string, unknown> = { reference_id: o.customId, custom_id: o.customId, amount: o.amount }
    if (o.captureId) {
      unit.payments = {
        captures: [
          {
            id: o.captureId,
            status: "COMPLETED",
            amount: o.amount,
            custom_id: o.customId,
            create_time: "2026-11-17T12:04:11Z",
            seller_receivable_breakdown: { paypal_fee: { currency_code: o.amount.currency_code, value: "1.00" } },
          },
        ],
      }
    }
    return { id: o.id, status: o.status, purchase_units: [unit], payer: { email_address: "kemi@example.test", name: { given_name: "Kemi", surname: "Adeyemi" } } }
  }

  private paypal(url: URL, method: string, headers: Record<string, string>, body: string): Response {
    if (method === "POST" && url.pathname === "/v1/oauth2/token") {
      const expected = `Basic ${Buffer.from(`${PAYPAL_FAKE.clientId}:${PAYPAL_FAKE.clientSecret}`).toString("base64")}`
      if (headers.authorization !== expected) return json(401, { error: "invalid_client", error_description: "Client Authentication failed" })
      return json(200, { access_token: "A21AA-fake-token", token_type: "Bearer", expires_in: 32400 })
    }
    if (headers.authorization !== "Bearer A21AA-fake-token") return json(401, { error: "invalid_token", error_description: "Token signature verification failed" })
    if (method === "POST" && url.pathname === "/v2/checkout/orders") {
      const b = JSON.parse(body) as { purchase_units: { custom_id: string; amount: FakePayPalOrder["amount"] }[] }
      const id = `FAKEORDER${String(this.nextOrder++).padStart(6, "0")}`
      this.paypalOrders.set(id, { id, customId: b.purchase_units[0].custom_id, amount: b.purchase_units[0].amount, status: "PAYER_ACTION_REQUIRED", captureId: null })
      return json(201, { id, status: "PAYER_ACTION_REQUIRED", links: [{ rel: "payer-action", href: `https://www.paypal.test/checkoutnow?token=${id}`, method: "GET" }] })
    }
    const capture = /^\/v2\/checkout\/orders\/([^/]+)\/capture$/.exec(url.pathname)
    if (method === "POST" && capture) {
      const order = this.paypalOrders.get(capture[1])
      if (!order) return json(404, { name: "RESOURCE_NOT_FOUND", message: "The specified resource does not exist." })
      if (order.status === "COMPLETED") return json(422, { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "ORDER_ALREADY_CAPTURED" }], message: "The requested action could not be performed." })
      if (order.status !== "APPROVED") return json(422, { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "ORDER_NOT_APPROVED" }], message: "The requested action could not be performed." })
      order.status = "COMPLETED"
      order.captureId = `FAKECAPTURE${order.id.slice(-6)}`
      return json(201, this.paypalOrderJson(order))
    }
    const show = /^\/v2\/checkout\/orders\/([^/]+)$/.exec(url.pathname)
    if (method === "GET" && show) {
      const order = this.paypalOrders.get(show[1])
      return order ? json(200, this.paypalOrderJson(order)) : json(404, { name: "RESOURCE_NOT_FOUND", message: "The specified resource does not exist." })
    }
    if (method === "POST" && url.pathname === "/v1/notifications/verify-webhook-signature") {
      const b = JSON.parse(body) as { transmission_sig?: string; webhook_id?: string; webhook_event?: unknown }
      const ok = b.transmission_sig === PAYPAL_FAKE.validSignature && b.webhook_id === PAYPAL_FAKE.webhookId && typeof b.webhook_event === "object"
      return json(200, { verification_status: ok ? "SUCCESS" : "FAILURE" })
    }
    return json(404, { name: "RESOURCE_NOT_FOUND", message: "Not found" })
  }
}

/** A response that never comes: rejects only when the caller's signal aborts (its timeout), as fetch does. */
function never(signal: AbortSignal | null | undefined): Promise<Response> {
  return new Promise((_, reject) => {
    if (!signal) return
    if (signal.aborted) return reject(signal.reason)
    signal.addEventListener("abort", () => reject(signal.reason), { once: true })
  })
}
