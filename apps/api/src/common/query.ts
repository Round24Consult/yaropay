/** Helpers for list-style query strings (`?product=a,b&product=c`). */
export type Query = Record<string, string | string[] | undefined>

export function list(q: Query, key: string): string[] {
  const raw = q[key]
  const values = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw]
  return values
    .flatMap((v) => v.split(","))
    .map((v) => v.trim())
    .filter(Boolean)
}

export function str(q: Query, key: string): string | undefined {
  const raw = q[key]
  const v = Array.isArray(raw) ? raw[0] : raw
  return v === undefined || v === "" ? undefined : v
}

export function int(q: Query, key: string, fallback: number, max = Number.MAX_SAFE_INTEGER): number {
  const n = Number.parseInt(str(q, key) ?? "", 10)
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : fallback
}

export function modeOf(q: Query): "test" | "live" {
  return str(q, "mode") === "test" ? "test" : "live"
}

export function pageMeta(total: number, page: number, pageSize: number) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const p = Math.min(page, pages)
  return { total, page: p, pageSize, pages, offset: (p - 1) * pageSize }
}
