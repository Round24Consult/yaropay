/**
 * Caps what forged or broken gateway webhook posts can cost. A gateway webhook URL is not a secret
 * (anyone who sees it can post to it), so posts with a bad signature are counted per sending address
 * and per gateway account. Only a limited number are stored for review; the rest are answered without
 * touching the database. Correctly signed posts never pass through here, so real gateway events are
 * never slowed down, even if many senders appear to share one address behind a proxy.
 */
export class InvalidSignatureLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>()

  constructor(
    private readonly perAddress = { limit: 20, windowMs: 60_000 },
    private readonly perAccount = { limit: 20, windowMs: 10 * 60_000 },
  ) {}

  /** Counts one badly signed post. `store`: keep a record of it. `throttle`: the sender should back off (429). */
  record(address: string | null, connectionId: string, now = Date.now()): { store: boolean; throttle: boolean } {
    const addressOver = address ? this.bump(`addr:${address}`, this.perAddress, now) : false
    const accountOver = this.bump(`acct:${connectionId}`, this.perAccount, now)
    return { store: !addressOver && !accountOver, throttle: addressOver }
  }

  private bump(key: string, rule: { limit: number; windowMs: number }, now: number): boolean {
    if (this.windows.size > 10_000) this.prune(now)
    const w = this.windows.get(key)
    if (!w || w.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + rule.windowMs })
      return false
    }
    w.count += 1
    return w.count > rule.limit
  }

  private prune(now: number) {
    for (const [key, w] of this.windows) if (w.resetAt <= now) this.windows.delete(key)
  }
}
