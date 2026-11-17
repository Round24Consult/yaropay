import { describe, expect, it } from "vitest"
import { base32Decode, base32Encode, generateRecoveryCodes, normaliseRecoveryCode, otpauthUri, totpCode, totpStep, verifyTotp } from "./totp.js"

// RFC 6238 appendix B, SHA-1 rows: secret "12345678901234567890", 8 digits.
const RFC_SECRET = Buffer.from("12345678901234567890")
const RFC_VECTORS: [number, string][] = [
  [59, "94287082"],
  [1111111109, "07081804"],
  [1111111111, "14050471"],
  [1234567890, "89005924"],
  [2000000000, "69279037"],
  [20000000000, "65353130"],
]

describe("TOTP", () => {
  it("matches the RFC 6238 test vectors", () => {
    for (const [seconds, code] of RFC_VECTORS) expect(totpCode(RFC_SECRET, totpStep(seconds * 1000), 8)).toBe(code)
  })

  it("round-trips base32", () => {
    expect(base32Encode(RFC_SECRET)).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ")
    expect(base32Decode("gezd gnbv-gy3t qojq gezd gnbv gy3t qojq").equals(RFC_SECRET)).toBe(true)
  })

  it("accepts the current code and its neighbours, and refuses reuse", () => {
    const secret = base32Encode(RFC_SECRET)
    const at = 1_700_000_000_000
    const step = totpStep(at)
    const now = totpCode(RFC_SECRET, step)
    expect(verifyTotp(secret, now, { at })).toBe(step)
    expect(verifyTotp(secret, totpCode(RFC_SECRET, step - 1), { at })).toBe(step - 1)
    expect(verifyTotp(secret, totpCode(RFC_SECRET, step + 1), { at })).toBe(step + 1)
    expect(verifyTotp(secret, totpCode(RFC_SECRET, step - 2), { at })).toBeNull()
    // Already used: the same step (or an older one) is refused.
    expect(verifyTotp(secret, now, { at, lastStep: step })).toBeNull()
    expect(verifyTotp(secret, "12345", { at })).toBeNull()
    expect(verifyTotp(secret, "abcdef", { at })).toBeNull()
  })

  it("builds the authenticator link", () => {
    const uri = otpauthUri({ issuer: "YaroPay", account: "ada@example.test", secret: "ABC" })
    expect(uri).toBe("otpauth://totp/YaroPay%3Aada%40example.test?secret=ABC&issuer=YaroPay&algorithm=SHA1&digits=6&period=30")
  })

  it("makes distinct recovery codes that normalise the same however they're typed", () => {
    const codes = generateRecoveryCodes()
    expect(codes).toHaveLength(10)
    expect(new Set(codes).size).toBe(10)
    for (const c of codes) expect(c).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{2}$/)
    expect(normaliseRecoveryCode(" K7QM-x2pd 9H ")).toBe("k7qmx2pd9h")
  })
})
