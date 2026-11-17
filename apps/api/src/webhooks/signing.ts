import { hmacHex } from "../common/crypto.js"

/** `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">` keyed with the product's signing secret. */
export function signPayload(secret: string, body: string, timestamp = Math.floor(Date.now() / 1000)): string {
  return `t=${timestamp},v1=${hmacHex("sha256", secret, `${timestamp}.${body}`)}`
}
