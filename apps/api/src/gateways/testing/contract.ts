/**
 * The shared tests every gateway adapter must pass. An adapter's own adapter.test.ts calls
 * `describeGatewayContract` with fixtures recorded from the gateway's sandbox; add gateway-specific
 * tests beside it for anything the contract doesn't cover.
 */
import { readFileSync } from "node:fs"
import type { Mode, TransactionStatus } from "@yaropay/core/types"
import { describe, expect, it } from "vitest"
import type { CallbackParams, Credentials, FinalizeParams, GatewayAdapter, GatewayPayment, InitializeParams, ParsedWebhook, PaymentRef } from "../kit.js"
import { fakeGateway, type RecordedResponse, type Route } from "./fake-gateway.js"

export type { RecordedResponse, Route } from "./fake-gateway.js"

/** What a test expects: any subset of the fields, at any depth (checked with toMatchObject). */
export type Expected<T> = T extends readonly unknown[] ? T : T extends object ? { [K in keyof T]?: Expected<T[K]> } : T

export interface GatewayFixtures {
  /** Keys the sandbox accepted when the responses were recorded (use placeholders, never real keys). */
  credentials: Credentials
  /** The account mode the fixtures were recorded in. Defaults to "test". */
  mode?: Mode
  /**
   * Calls the adapter makes alongside the one under test, such as an OAuth token endpoint. Served in
   * every test; a test's own route wins when both match.
   */
  routes?: Partial<Record<Route, RecordedResponse>>
  initialize: {
    params: InitializeParams
    route: Route
    response: RecordedResponse
    /** Fields the request must contain, such as the amount in the gateway's own units. */
    sends: Record<string, unknown>
    returns: { authorizationUrl: string; checkoutId?: string | null }
  }
  /**
   * Status checks. Cover at least a successful, a failed and an abandoned (or cancelled) payment, and one
   * the gateway doesn't know (`expect: null`). Every found payment must state its exact `amount` (minor
   * units) and `currency`.
   */
  verify: { name: string; ref: PaymentRef; route: Route; response: RecordedResponse; expect: (Expected<GatewayPayment> & { amount: number; currency: string; status: TransactionStatus }) | null }[]
  webhook: {
    /** A webhook exactly as the gateway sent it: the raw body and the headers that sign it. */
    signed: { rawBody: string; headers: Record<string, string> }
    /** False for gateways whose signature doesn't cover the body (Flutterwave's shared hash). */
    bodySigned?: boolean
    /** Calls the adapter makes to check a signature, for gateways that verify webhooks by API. */
    routes?: Partial<Record<Route, RecordedResponse>>
    /** Webhook bodies and what parseWebhook must make of them. Include a successful payment. */
    events: { name: string; body: unknown; expect: Expected<ParsedWebhook> }[]
  }
  /** Return-URL query strings and what parseCallback must make of them. */
  callback: { name: string; query: Record<string, string | undefined>; expect: Expected<CallbackParams> }[]
  testConnection: {
    route: Route
    ok: RecordedResponse
    /** What the gateway answers to a wrong key. Defaults to a 401. */
    rejected?: RecordedResponse
  }
  /** Required when the adapter implements `finalize` (PayPal's capture, for example). */
  finalize?: { params: FinalizeParams; route: Route; response: RecordedResponse }
}

/** Reads a recorded response body next to the test: `fixture(import.meta.url, "fixtures/verify-success.json")`. */
export function fixture<T = unknown>(base: string, path: string): T {
  return JSON.parse(readFileSync(new URL(path, base), "utf8")) as T
}

const REQUIRED_STATUSES: TransactionStatus[] = ["success", "failed", "abandoned"]

/**
 * Registers the contract tests for one adapter. Pass `pending: true` while the fixtures are still being
 * recorded: the tests are listed as to-do and the fixtures aren't read.
 */
export function describeGatewayContract(adapter: GatewayAdapter, load: () => GatewayFixtures, opts: { pending?: boolean } = {}) {
  describe(`${adapter.name} adapter contract`, () => {
    if (opts.pending) {
      for (const name of ["initialize", "verify", "webhook signatures", "webhook parsing", "callback parsing", "test connection"]) it.todo(name)
      return
    }
    const f = load()
    const mode = f.mode ?? "test"

    it("starts a checkout with the right request and returns its URL", async () => {
      const gw = fakeGateway({ ...f.routes, [f.initialize.route]: f.initialize.response }, mode)
      const result = await adapter.initialize(gw.ctx, f.credentials, f.initialize.params)
      expect(result.authorizationUrl).toBe(f.initialize.returns.authorizationUrl)
      if (f.initialize.returns.checkoutId !== undefined) expect(result.checkoutId ?? null).toBe(f.initialize.returns.checkoutId)
      const [method, path] = f.initialize.route.split(" ")
      const request = gw.sent.find((r) => r.method === method && r.path.split("?")[0] === path.split("?")[0])
      expect(request, `expected a ${f.initialize.route} request`).toBeDefined()
      expect(request?.parsed).toMatchObject(f.initialize.sends)
    })

    it("covers the statuses every gateway must report", () => {
      const statuses = new Set(f.verify.map((c) => c.expect?.status ?? null))
      for (const s of REQUIRED_STATUSES) expect(statuses.has(s), `add a verify fixture for a ${s} payment`).toBe(true)
      expect(statuses.has(null), "add a verify fixture for a payment the gateway doesn't know (expect: null)").toBe(true)
    })

    for (const c of f.verify) {
      it(`verifies: ${c.name}`, async () => {
        const gw = fakeGateway({ ...f.routes, [c.route]: c.response }, mode)
        const payment = await adapter.verify(gw.ctx, f.credentials, c.ref)
        if (c.expect === null) {
          expect(payment).toBeNull()
          return
        }
        expect(payment).not.toBeNull()
        expect(payment).toMatchObject(c.expect)
        // Money is always whole minor units.
        expect(Number.isInteger(payment?.amount)).toBe(true)
        expect(Number.isInteger(payment?.fee)).toBe(true)
      })
    }

    it("accepts a correctly signed webhook and refuses tampered or unsigned ones", async () => {
      const gw = fakeGateway({ ...f.routes, ...f.webhook.routes }, mode)
      const raw = Buffer.from(f.webhook.signed.rawBody)
      const headers = f.webhook.signed.headers
      expect(await adapter.verifySignature(gw.ctx, f.credentials, raw, headers)).toBe(true)
      expect(await adapter.verifySignature(gw.ctx, f.credentials, raw, {})).toBe(false)
      for (const name of Object.keys(headers)) {
        const forged = { ...headers, [name]: `${headers[name].slice(0, -2)}xx` }
        expect(await adapter.verifySignature(gw.ctx, f.credentials, raw, forged), `a changed ${name} header must be refused`).toBe(false)
      }
      if (f.webhook.bodySigned !== false) {
        const tampered = Buffer.from(f.webhook.signed.rawBody.replace(/\d/, (d) => String((Number(d) + 1) % 10)))
        expect(tampered.equals(raw), "the signed webhook fixture needs a digit somewhere to tamper with").toBe(false)
        expect(await adapter.verifySignature(gw.ctx, f.credentials, tampered, headers), "a changed body must be refused").toBe(false)
      }
    })

    for (const e of f.webhook.events) {
      it(`parses the webhook: ${e.name}`, () => {
        expect(adapter.parseWebhook(e.body)).toMatchObject(e.expect)
      })
    }

    for (const c of f.callback) {
      it(`parses the return URL: ${c.name}`, () => {
        expect(adapter.parseCallback(c.query)).toMatchObject(c.expect)
      })
    }

    it("tests a connection: accepted and rejected keys", async () => {
      const ok = fakeGateway({ ...f.routes, [f.testConnection.route]: f.testConnection.ok }, mode)
      expect(await adapter.testConnection(ok.ctx, f.credentials)).toMatchObject({ ok: true })
      const rejected = fakeGateway({ ...f.routes, [f.testConnection.route]: f.testConnection.rejected ?? { status: 401, body: { message: "Invalid key" } } }, mode)
      expect(await adapter.testConnection(rejected.ctx, f.credentials)).toMatchObject({ ok: false })
    })

    if (adapter.finalize) {
      it("completes an approved payment when the customer returns", async () => {
        expect(f.finalize, "this adapter implements finalize: add a finalize fixture").toBeDefined()
        if (!f.finalize || !adapter.finalize) return
        const gw = fakeGateway({ ...f.routes, [f.finalize.route]: f.finalize.response }, mode)
        await adapter.finalize(gw.ctx, f.credentials, f.finalize.params)
        const [method, path] = f.finalize.route.split(" ")
        expect(gw.sent.some((r) => r.method === method && r.path.split("?")[0] === path.split("?")[0])).toBe(true)
      })
    }
  })
}
