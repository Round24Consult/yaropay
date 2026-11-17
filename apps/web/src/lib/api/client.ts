import type { ApiError } from "@yaropay/core/api"

/**
 * Base path of the YaroPay API. The Next.js rewrites in next.config.ts forward
 * /api/* to the NestJS API (YAROPAY_API_URL), so requests stay same-origin and
 * carry the httpOnly session cookie.
 */
export const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api").replace(/\/$/, "")

export class ApiRequestError extends Error {
  status: number
  code?: string
  fields?: Record<string, string>
  constructor(status: number, body: ApiError | null) {
    super(body?.error?.message ?? `Request failed (${status})`)
    this.status = status
    this.code = body?.error?.code
    this.fields = body?.error?.fields
  }
}

type Params = Record<string, string | number | boolean | string[] | null | undefined>

export function toQuery(params: Params = {}) {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue
    if (Array.isArray(v)) {
      if (v.length) sp.set(k, v.join(","))
    } else sp.set(k, String(v))
  }
  const s = sp.toString()
  return s ? `?${s}` : ""
}

const AUTH_PAGES = ["/login", "/setup", "/forgot-password", "/reset-password", "/invite", "/signup", "/verify-email"]

/** Where to send someone whose session ended, keeping the page they were on. */
export function loginUrl(next?: string) {
  const target = next ?? (typeof window !== "undefined" ? `${window.location.pathname}${window.location.search}` : "/")
  return target && target !== "/" ? `/login?next=${encodeURIComponent(target)}` : "/login"
}

function onUnauthenticated() {
  if (typeof window === "undefined") return
  if (AUTH_PAGES.some((p) => window.location.pathname.startsWith(p))) return
  window.location.assign(loginUrl())
}

/**
 * The workspace this tab is showing. Sent with every request so the API can refuse to act on a
 * different company if another tab switched the session meanwhile.
 */
let activeWorkspace: string | null = null

export function setActiveWorkspace(id: string | null) {
  activeWorkspace = id
}

export async function api<T>(path: string, init: RequestInit & { params?: Params; json?: unknown } = {}): Promise<T> {
  const { params, json, headers, ...rest } = init
  const res = await fetch(`${API_BASE}${path}${toQuery(params)}`, {
    ...rest,
    headers: {
      accept: "application/json",
      ...(json !== undefined ? { "content-type": "application/json" } : {}),
      ...(activeWorkspace ? { "x-workspace-id": activeWorkspace } : {}),
      ...headers,
    },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
    cache: "no-store",
    credentials: "same-origin",
  })
  const text = await res.text()
  let body: unknown = null
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      body = null
    }
  }
  if (!res.ok) {
    // A 401 outside /auth means the session expired or was revoked.
    if (res.status === 401 && !path.startsWith("/auth/")) onUnauthenticated()
    const err = new ApiRequestError(res.status, (body as ApiError | null) ?? null)
    // Another tab switched workspace: start over in the one the session is in now.
    if (err.code === "workspace_changed" && typeof window !== "undefined") window.location.reload()
    if (!body && res.status >= 500) err.message = "The YaroPay API is not reachable. Is it running?"
    throw err
  }
  return body as T
}
