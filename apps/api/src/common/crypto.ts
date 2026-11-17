import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto"

const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz"

/** Random lowercase id with a type prefix, e.g. `txn_8f2k1c7q4m9z`. */
export function newId(prefix: string, length = 12): string {
  const bytes = randomBytes(length)
  let s = ""
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length]
  return `${prefix}_${s}`
}

/** URL-safe random token for sessions, invites and resets. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url")
}

/** Random secret with a readable prefix, e.g. `ypk_live_...`. */
export function randomSecret(prefix: string, length = 32): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789"
  const bytes = randomBytes(length)
  let s = ""
  for (const b of bytes) s += alphabet[b % alphabet.length]
  return `${prefix}${s}`
}

export function secretPreview(secret: string, prefix: string): string {
  return `${prefix}••••${secret.slice(-4)}`
}

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex")
}

export function hmacHex(algorithm: "sha256" | "sha512", key: string, data: string | Buffer): string {
  return createHmac(algorithm, key).update(data).digest("hex")
}

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

/** AES-256-GCM. Output: `v1.<iv>.<tag>.<ciphertext>` (base64url parts). */
export function encrypt(key: Buffer, plaintext: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key, iv)
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), data.toString("base64url")].join(".")
}

/** Tries each key in turn (the current one first, during a rotation the old ones after). */
export function decryptWithKeys(keys: readonly Buffer[], payload: string): string {
  let last: unknown
  for (const key of keys) {
    try {
      return decrypt(key, payload)
    } catch (e) {
      last = e
    }
  }
  throw last instanceof Error ? last : new Error("Could not decrypt")
}

export function decrypt(key: Buffer, payload: string): string {
  const [version, iv, tag, data] = payload.split(".")
  if (version !== "v1" || !iv || !tag || data === undefined) throw new Error("Unsupported ciphertext format")
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"))
  decipher.setAuthTag(Buffer.from(tag, "base64url"))
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8")
}
