import type { Mode } from "@yaropay/core/types"
import type { AdapterContext } from "../kit.js"

/** A response recorded from the gateway's sandbox (secrets removed). */
export interface RecordedResponse {
  /** HTTP status; 200 when left out. */
  status?: number
  body: unknown
}

/**
 * Answers from the request, for calls whose answer depends on what was sent, such as a gateway's own
 * signature check (PayPal's verify-webhook-signature).
 */
export type Responder = (request: SentRequest) => RecordedResponse

/** `METHOD /path`, optionally with the query string, e.g. `GET /transaction/verify/SHW_1`. */
export type Route = `${"GET" | "POST" | "PUT" | "PATCH" | "DELETE"} /${string}`

export interface SentRequest {
  method: string
  /** Path and query, relative to the API base URL. */
  path: string
  headers: Record<string, string>
  body: string
  /** The body parsed as JSON, or as a form when the adapter sent one; null otherwise. */
  parsed: unknown
}

export const FAKE_BASE_URL = "https://gateway.test/api"

function parse(body: string, headers: Record<string, string>): unknown {
  if (!body) return null
  if ((headers["content-type"] ?? "").includes("application/x-www-form-urlencoded")) return Object.fromEntries(new URLSearchParams(body))
  try {
    return JSON.parse(body)
  } catch {
    return null
  }
}

/**
 * A stand-in for a gateway's API that answers from recorded responses. Routes match on method and path,
 * with the query string when the route gives one. Anything else answers 500 "no fixture", so a test
 * fails loudly instead of reading a 404 as "payment not found".
 */
export function fakeGateway(routes: Partial<Record<Route, RecordedResponse | Responder>>, mode: Mode = "test") {
  const sent: SentRequest[] = []
  const fetch = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url)
    const headers: Record<string, string> = {}
    new Headers(init.headers).forEach((v, k) => {
      headers[k] = v
    })
    const method = (init.method ?? "GET").toUpperCase()
    const base = new URL(FAKE_BASE_URL)
    const path = (url.pathname.startsWith(base.pathname) ? url.pathname.slice(base.pathname.length) : url.pathname) || "/"
    const body = typeof init.body === "string" ? init.body : ""
    const request: SentRequest = { method, path: `${path}${url.search}`, headers, body, parsed: parse(body, headers) }
    sent.push(request)
    const route = routes[`${method} ${path}${url.search}` as Route] ?? routes[`${method} ${path}` as Route]
    if (!route) return Response.json({ message: `No fixture for ${method} ${path}${url.search}` }, { status: 500 })
    const hit = typeof route === "function" ? route(request) : route
    return Response.json(hit.body, { status: hit.status ?? 200 })
  }
  const ctx: AdapterContext = { fetch, baseUrl: FAKE_BASE_URL, mode, timeoutMs: 5_000 }
  return { ctx, sent }
}
