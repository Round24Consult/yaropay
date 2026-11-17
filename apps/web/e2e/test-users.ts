/** Test-only accounts for the e2e API (seeded into a throwaway embedded database). */

/**
 * Website screenshots (`npm run screenshots`) show the real owner and company; every other run uses the
 * test company the specs expect.
 */
const SCREENSHOTS = Boolean(process.env.SITE_SCREENSHOTS)

export const E2E_OWNER = SCREENSHOTS
  ? { name: "Innocent Ejeh", email: "hello@yaropay.com", password: "e2e-owner-password-1" }
  : { name: "Ada Okafor", email: "owner@company-a.test", password: "e2e-owner-password-1" }
export const E2E_COMPANY = SCREENSHOTS ? "Round24consult Limited" : "Company A"
export const E2E_PORTS = { api: 4300, web: 3200, hooks: 4310 }
export const AUTH_FILE = "e2e/.auth/owner.json"
