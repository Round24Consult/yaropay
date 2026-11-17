import type { Product } from "./types.ts"

/** Metadata key YaroPay writes on every transaction it initialises. */
export const PRODUCT_METADATA_KEY = "yaropay_product"

const PREFIX_RE = /^[A-Z][A-Z0-9]{1,5}$/

export function isValidPrefix(prefix: string): boolean {
  return PREFIX_RE.test(prefix)
}

/** Suggests a 3-letter reference prefix from a product name, avoiding ones in use. */
export function suggestPrefix(name: string, taken: string[] = []): string {
  const letters = name.toUpperCase().replace(/[^A-Z0-9 ]/g, "")
  const words = letters.split(/\s+/).filter(Boolean)
  const candidates: string[] = []
  if (words.length >= 3) candidates.push(words.slice(0, 3).map((w) => w[0]).join(""))
  if (words.length === 2) candidates.push(words[0].slice(0, 2) + words[1][0])
  const flat = letters.replace(/\s+/g, "")
  if (flat.length >= 3) {
    candidates.push(flat[0] + flat.slice(1).replace(/[AEIOU]/g, "").slice(0, 2))
    candidates.push(flat.slice(0, 3))
  }
  const takenSet = new Set(taken.map((t) => t.toUpperCase()))
  for (const c of candidates) {
    if (c.length >= 2 && isValidPrefix(c) && !takenSet.has(c)) return c
  }
  const base = (candidates[0] ?? "PRD").slice(0, 3).padEnd(3, "X")
  for (let i = 2; i < 100; i++) {
    const c = `${base}${i}`
    if (!takenSet.has(c)) return c
  }
  return `${base}${Date.now() % 1000}`
}

/** Builds a transaction reference such as `SHW_9F2K1C7Q`. */
export function makeReference(prefix: string, random: () => number = Math.random): string {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
  let body = ""
  for (let i = 0; i < 10; i++) body += alphabet[Math.floor(random() * alphabet.length)]
  return `${prefix}_${body}`
}

export type RouteMatch =
  | { productId: string; matchedBy: "metadata" | "prefix" }
  | { productId: null; matchedBy: null }

/**
 * Finds the product that owns an incoming gateway event. Metadata wins
 * (it is set by YaroPay at initialisation), then the reference prefix.
 * Anything else is "unrouted" and is held for manual review.
 */
export function resolveProduct(
  products: Pick<Product, "id" | "referencePrefix">[],
  reference: string | null | undefined,
  metadata?: Record<string, unknown> | null,
): RouteMatch {
  const fromMeta = metadata?.[PRODUCT_METADATA_KEY]
  if (typeof fromMeta === "string" && products.some((p) => p.id === fromMeta)) {
    return { productId: fromMeta, matchedBy: "metadata" }
  }
  if (reference) {
    const prefix = reference.split("_")[0]?.toUpperCase()
    const hit = products.find((p) => p.referencePrefix.toUpperCase() === prefix)
    if (hit) return { productId: hit.id, matchedBy: "prefix" }
  }
  return { productId: null, matchedBy: null }
}
