import { type CurrencyCode, currencyInfo, minorUnitExponent, toMajorUnits, toMinorUnits } from "./currencies.ts"
import { SUPPORTED_CURRENCIES } from "./gateways/registry.ts"

/** Currencies the installed gateways accept, for currency pickers and filters. */
export const CURRENCIES: { code: CurrencyCode; name: string }[] = SUPPORTED_CURRENCIES.map((code) => ({ code, name: currencyInfo(code).name }))

/** Minor units to major units, using the currency's own decimal places. */
export function toMajor(minor: number, currency: CurrencyCode): number {
  return toMajorUnits(minor, currency)
}

/** Major units to whole minor units, using the currency's own decimal places. */
export function toMinor(major: number, currency: CurrencyCode): number {
  return toMinorUnits(major, currency)
}

const cache = new Map<string, Intl.NumberFormat>()

function formatter(currency: CurrencyCode, compact: boolean, decimals: boolean) {
  const key = `${currency}:${compact}:${decimals}`
  let f = cache.get(key)
  if (!f) {
    f = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
      notation: compact ? "compact" : "standard",
      maximumFractionDigits: compact ? 1 : decimals ? minorUnitExponent(currency) : 0,
      minimumFractionDigits: compact ? 0 : decimals ? minorUnitExponent(currency) : 0,
    })
    cache.set(key, f)
  }
  return f
}

/** Formats minor units, e.g. 1500000 NGN -> "₦15,000.00". */
export function formatMoney(
  minor: number,
  currency: CurrencyCode,
  opts: { compact?: boolean; decimals?: boolean } = {},
): string {
  const { compact = false, decimals = true } = opts
  return formatter(currency, compact, decimals).format(toMajor(minor, currency))
}

const numberCompact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 })
const numberFull = new Intl.NumberFormat("en-US")

export function formatCount(n: number, compact = false): string {
  return compact && Math.abs(n) >= 10_000 ? numberCompact.format(n) : numberFull.format(n)
}

export function formatPercent(ratio: number, digits = 1): string {
  if (!Number.isFinite(ratio)) return "–"
  return `${(ratio * 100).toFixed(digits)}%`
}

/** Relative change, or null when the previous value is zero. */
export function delta(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null
  return (current - previous) / previous
}
