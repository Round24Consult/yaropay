import { lookup } from "node:dns/promises"
import { isIP } from "node:net"

/** True for loopback, private, link-local, CGNAT, multicast and other non-public ranges. */
export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip)
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number)
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    )
  }
  if (v === 6) {
    const lower = ip.toLowerCase()
    if (lower === "::" || lower === "::1") return true
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower)
    if (mapped) return isPrivateAddress(mapped[1])
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(lower)
  }
  return true
}

/**
 * Refuses URLs that point at the install's own network, so a product webhook
 * URL cannot be used to reach internal services. Set WEBHOOK_ALLOW_PRIVATE=true
 * when your products run on the same private network.
 */
export async function assertPublicUrl(url: string): Promise<void> {
  const host = new URL(url).hostname.replace(/^\[|\]$/g, "")
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true })
  if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address))) {
    throw new Error(`${host} resolves to a private address. Set WEBHOOK_ALLOW_PRIVATE=true to allow it.`)
  }
}
