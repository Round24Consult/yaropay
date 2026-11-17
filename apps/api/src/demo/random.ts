/** Small seeded PRNG so the demo data is the same on every start. */
export function mulberry32(seed: number) {
  let a = seed >>> 0
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export type Rng = () => number

export function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)]
}

/** Picks from `[value, weight]` pairs. */
export function weighted<T>(rng: Rng, entries: readonly (readonly [T, number])[]): T {
  const total = entries.reduce((s, [, w]) => s + w, 0)
  let r = rng() * total
  for (const [v, w] of entries) {
    r -= w
    if (r <= 0) return v
  }
  return entries[entries.length - 1][0]
}

export function between(rng: Rng, min: number, max: number) {
  return min + rng() * (max - min)
}

/** Log-normal-ish amount, rounded to a tidy step. */
export function amountAround(rng: Rng, median: number, spread: number, step: number) {
  const u = Math.max(1e-9, rng())
  const v = rng()
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  const value = median * Math.exp(z * spread)
  return Math.max(step, Math.round(value / step) * step)
}

/** Poisson sample (Knuth), fine for the small means used here. */
export function poisson(rng: Rng, mean: number) {
  const L = Math.exp(-mean)
  let k = 0
  let p = 1
  do {
    k++
    p *= rng()
  } while (p > L)
  return k - 1
}

const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz"

export function randomId(rng: Rng, prefix: string, length = 10) {
  let s = ""
  for (let i = 0; i < length; i++) s += ALPHABET[Math.floor(rng() * ALPHABET.length)]
  return `${prefix}_${s}`
}
