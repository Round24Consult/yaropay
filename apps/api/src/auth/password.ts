import { randomBytes, scrypt, timingSafeEqual } from "node:crypto"

/**
 * scrypt password hashing (OWASP: N=2^16, r=8, p=2 uses about 64 MiB per hash).
 * Stored as `scrypt$<logN>$<r>$<p>$<salt>$<hash>` so the cost can be raised later.
 */
const COSTS = { standard: { logN: 16, r: 8, p: 2 }, fast: { logN: 10, r: 8, p: 1 } } as const

function derive(password: string, salt: Buffer, logN: number, r: number, p: number): Promise<Buffer> {
  const N = 2 ** logN
  return new Promise((resolve, reject) => {
    scrypt(password.normalize("NFKC"), salt, 32, { N, r, p, maxmem: 256 * N * r + 1024 * 1024 }, (err, key) =>
      err ? reject(err) : resolve(key),
    )
  })
}

export async function hashPassword(password: string, cost: keyof typeof COSTS = "standard"): Promise<string> {
  const { logN, r, p } = COSTS[cost]
  const salt = randomBytes(16)
  const key = await derive(password, salt, logN, r, p)
  return ["scrypt", logN, r, p, salt.toString("base64url"), key.toString("base64url")].join("$")
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, logN, r, p, salt, hash] = stored.split("$")
  if (scheme !== "scrypt" || !salt || !hash) return false
  const expected = Buffer.from(hash, "base64url")
  const key = await derive(password, Buffer.from(salt, "base64url"), Number(logN), Number(r), Number(p))
  return key.length === expected.length && timingSafeEqual(key, expected)
}

/** A hash to compare against when the email is unknown, so timing does not reveal accounts. */
let dummy: Promise<string> | null = null
export function dummyHash(cost: keyof typeof COSTS): Promise<string> {
  dummy ??= hashPassword(randomBytes(16).toString("hex"), cost)
  return dummy
}
