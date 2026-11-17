import { createHmac } from "node:crypto"

/** What an authenticator app shows for a base32 secret, `offset` 30-second steps from now. */
export function totp(secret: string, offset = 0): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
  let bits = 0
  let value = 0
  const bytes: number[] = []
  for (const ch of secret.replace(/\s/g, "")) {
    value = (value << 5) | alphabet.indexOf(ch)
    bits += 5
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000) + offset))
  const mac = createHmac("sha1", Buffer.from(bytes)).update(counter).digest()
  const o = mac[mac.length - 1] & 0x0f
  const bin = ((mac[o] & 0x7f) << 24) | (mac[o + 1] << 16) | (mac[o + 2] << 8) | mac[o + 3]
  return String(bin % 1_000_000).padStart(6, "0")
}
