import { createHmac, randomBytes } from "node:crypto"

/**
 * Time-based one-time codes (RFC 6238) as authenticator apps make them: HMAC-SHA1, 30-second steps,
 * 6 digits. Written out here instead of pulling in a package: it's a few lines and easy to check
 * against the RFC's test vectors.
 */

export const TOTP_STEP_SECONDS = 30
export const TOTP_DIGITS = 6
/** Codes from one step either side are accepted, for clocks that drift a little. */
const WINDOW = 1

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"

export function base32Encode(buf: Buffer): string {
  let bits = 0
  let value = 0
  let out = ""
  for (const byte of buf) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31]
  return out
}

export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[\s=-]/g, "")
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const ch of clean) {
    const i = ALPHABET.indexOf(ch)
    if (i < 0) throw new Error("Not a base32 string")
    value = (value << 5) | i
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

/** A new 160-bit secret, base32 as authenticator apps expect. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20))
}

export function totpStep(at: number = Date.now()): number {
  return Math.floor(at / 1000 / TOTP_STEP_SECONDS)
}

/** The code for one time step. `digits` is only ever changed by tests (the RFC vectors use 8). */
export function totpCode(secret: Buffer, step: number, digits = TOTP_DIGITS): string {
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(step))
  const mac = createHmac("sha1", secret).update(counter).digest()
  const offset = mac[mac.length - 1] & 0x0f
  const bin = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3]
  return String(bin % 10 ** digits).padStart(digits, "0")
}

/**
 * Checks a code against the current step and its neighbours. Returns the step it matched, or null.
 * Codes from `lastStep` or earlier are refused, so a code seen over someone's shoulder can't be reused.
 */
export function verifyTotp(secretBase32: string, code: string, opts: { at?: number; lastStep?: number | null } = {}): number | null {
  if (!/^\d{6}$/.test(code)) return null
  const secret = base32Decode(secretBase32)
  const now = totpStep(opts.at)
  for (let step = now - WINDOW; step <= now + WINDOW; step++) {
    if (opts.lastStep != null && step <= opts.lastStep) continue
    if (constantTimeEqual(totpCode(secret, step), code)) return step
  }
  return null
}

function constantTimeEqual(a: string, b: string) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** The link an authenticator app reads from the QR code. */
export function otpauthUri(opts: { issuer: string; account: string; secret: string }): string {
  const label = encodeURIComponent(`${opts.issuer}:${opts.account}`)
  const params = new URLSearchParams({
    secret: opts.secret,
    issuer: opts.issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  })
  return `otpauth://totp/${label}?${params.toString()}`
}

/** Ten single-use recovery codes like `k7qm-x2pd-9h`, for when the phone is lost. */
export function generateRecoveryCodes(count = 10): string[] {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789"
  return Array.from({ length: count }, () => {
    const bytes = randomBytes(10)
    const chars = [...bytes].map((b) => alphabet[b % alphabet.length]).join("")
    return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 10)}`
  })
}

/** Recovery codes are compared without dashes, spaces or case. */
export function normaliseRecoveryCode(code: string): string {
  return code.toLowerCase().replace(/[^a-z0-9]/g, "")
}
