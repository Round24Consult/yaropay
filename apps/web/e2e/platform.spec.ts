import { expect, test } from "@playwright/test"
import { E2E_OWNER } from "./test-users"
import { totp } from "./totp"

// The platform console is YaroPay Cloud only. Run with the paid build checked out:
//   E2E_EDITION=cloud npm run e2e -w @yaropay/web -- e2e/platform.spec.ts
test.skip(process.env.E2E_EDITION !== "cloud", "YaroPay Cloud only (E2E_EDITION=cloud)")

test("a super admin opens the platform console after turning on two-step sign-in, then manages plans and a company", async ({ page, browser }) => {
  // Without two-step sign-in, the console explains what's missing.
  await page.goto("/platform")
  await expect(page.getByTestId("platform-needs-mfa")).toBeVisible()

  await page.goto("/settings?tab=security")
  await page.getByTestId("mfa-setup-start").click()
  await page.getByTestId("mfa-password").fill(E2E_OWNER.password)
  await page.getByTestId("mfa-password-submit").click()
  const secret = (await page.getByTestId("mfa-secret").textContent())!.replace(/\s/g, "")
  await page.getByTestId("mfa-enable-code").fill(totp(secret))
  await page.getByTestId("mfa-enable-submit").click()
  await page.getByTestId("recovery-codes-done").click()

  // Turning it on upgraded this session, so the console opens straight away.
  await page.getByTestId("nav-platform").click()
  await expect(page).toHaveURL(/\/platform$/)
  await expect(page.getByTestId("platform-companies")).toContainText("1")
  await page.getByTestId("company-company-a").click()
  await expect(page.getByTestId("this-month")).toContainText(`isn't a Cloud plan`)

  // Put the company on the Standard plan.
  await page.getByTestId("billing-plan").click()
  await page.getByRole("option", { name: "Standard" }).click()
  await page.getByTestId("save-billing").click()
  await expect(page.getByText("Billing saved")).toBeVisible()
  await expect(page.getByTestId("this-month")).toContainText("Standard plan, billed in NGN.")

  // Plans: NGN 15,000 / USD 10 today; a new price from next month.
  await page.getByRole("link", { name: "Plans & pricing" }).click()
  const standard = page.getByTestId("plan-standard")
  await expect(standard).toContainText("₦15,000 / $10.00 per live product")
  await page.getByTestId("change-price-standard").click()
  await page.getByTestId("price-per-ngn").fill("20000")
  await page.getByTestId("volume-fee-on").click()
  await page.getByTestId("volume-rate").fill("0.5")
  await page.getByTestId("volume-threshold-ngn").fill("10000000")
  await page.getByTestId("save-price").click()
  await expect(page.getByText("New price starts next month")).toBeVisible()
  await expect(standard).toContainText("₦15,000 / $10.00 per live product")
  await expect(standard).toContainText("₦20,000 / $10.00 per live product")
  await expect(standard).toContainText("0.5% of live volume above ₦10,000,000")

  // Exchange rates.
  await page.getByTestId("rate-USD").fill("1550")
  await page.getByTestId("save-rates").click()
  await expect(page.getByText("Exchange rates saved")).toBeVisible()

  // The company sees its plan, the price change coming next month, and this month so far.
  await page.goto("/settings?tab=billing")
  await expect(page.getByTestId("billing-this-month")).toBeVisible()
  await expect(page.getByText("₦15,000 per live product a month", { exact: true })).toBeVisible()
  await expect(page.getByText(/: ₦20,000 per live product a month, plus 0\.5% of live volume above ₦10,000,000 a month/)).toBeVisible()
  await expect(page.getByTestId("settings-tab-licence")).toHaveCount(0)

  // Open sign-ups: the sign-in page links to the sign-up page, which takes a new company.
  await page.goto("/platform/pricing")
  await page.getByTestId("signups-open").click()
  await expect(page.getByText("Sign-ups are open")).toBeVisible()
  const visitor = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  const guest = await visitor.newPage()
  await guest.goto("/login")
  await guest.getByTestId("signup-link").click()
  await guest.getByLabel("Company").fill("Gamma Pay")
  await guest.getByLabel("Your name").fill("Chi Founder")
  await guest.getByLabel("Work email").fill("chi@gamma.test")
  await guest.getByLabel("Password", { exact: true }).fill("gamma-long-password")
  await guest.getByTestId("signup-submit").click()
  await expect(guest.getByRole("heading", { name: "Check your email" })).toBeVisible()
  // Until the link is used, signing in says to confirm the address.
  await guest.goto("/login")
  await guest.getByLabel("Email").fill("chi@gamma.test")
  await guest.getByLabel("Password", { exact: true }).fill("gamma-long-password")
  await guest.getByTestId("login-submit").click()
  await expect(guest.getByRole("heading", { name: "Check your email" })).toBeVisible()
  await visitor.close()
  await page.goto("/platform")
  await expect(page.getByTestId("company-gamma-pay")).toContainText("Test mode only")

  // A read-only support view of the new company, then back.
  await page.getByTestId("company-gamma-pay").click()
  await page.getByTestId("open-support").click()
  await page.getByLabel("Reason").fill("Ticket 7: checking their setup")
  await page.getByTestId("confirm-support").click()
  await expect(page.getByTestId("support-banner")).toContainText("Support view of Gamma Pay")
  await page.getByTestId("end-support").click()
  await expect(page).toHaveURL(/\/platform\/workspaces\//)
  await expect(page.getByTestId("support-banner")).toHaveCount(0)

  // A company for a customer: created, renamed, given a teammate, then closed and deleted.
  await page.goto("/platform")
  await page.getByTestId("new-company").click()
  await page.getByTestId("new-company-name").fill("Delta Foods")
  await page.getByTestId("new-company-owner").fill("owner@delta.test")
  await page.getByTestId("create-company").click()
  // No email on the test install: the dialog hands over the owner's invite link instead.
  await expect(page.getByText("Owner's invite link")).toBeVisible()
  await page.getByRole("button", { name: "Open the company" }).click()
  await expect(page.getByTestId("invite-owner@delta.test")).toContainText("Owner")
  await page.getByTestId("rename-company").click()
  await page.getByTestId("rename-company-name").fill("Delta Foods Ltd")
  await page.getByRole("button", { name: "Save name" }).click()
  await expect(page.getByRole("heading", { name: "Delta Foods Ltd" })).toBeVisible()
  await page.getByTestId("invite-to-company").click()
  await page.locator("#invite-email").fill("finance@delta.test")
  await page.getByRole("button", { name: "Send invite" }).click()
  await expect(page.getByText("Invite created")).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.getByTestId("invite-finance@delta.test")).toBeVisible()
  await page.getByTestId("suspend-workspace").click()
  await page.getByLabel("Reason").fill("Closing a test company")
  await page.getByTestId("confirm-suspend").click()
  await page.getByTestId("delete-company").click()
  await page.getByTestId("confirm-delete-name").fill("Delta Foods Ltd")
  await page.getByTestId("confirm-delete").click()
  await expect(page).toHaveURL(/\/platform$/)
  await expect(page.getByText("Delta Foods Ltd deleted")).toBeVisible()
  await expect(page.getByTestId("company-delta-foods")).toHaveCount(0)

  // People: find the sign-up's owner, disable the account, then re-enable it.
  await page.getByRole("link", { name: "People" }).click()
  await page.getByLabel("Search people").fill("chi@gamma.test")
  const chi = page.getByTestId("person-chi@gamma.test")
  await expect(chi).toContainText("Gamma Pay")
  await expect(chi).toContainText("Email not confirmed")
  await page.getByTestId("person-actions-chi@gamma.test").click()
  await page.getByRole("menuitem", { name: "Disable account" }).click()
  await page.getByTestId("confirm-person-action").click()
  await expect(chi).toContainText("Disabled")
  await page.getByTestId("person-actions-chi@gamma.test").click()
  await page.getByRole("menuitem", { name: "Re-enable account" }).click()
  await page.getByTestId("confirm-person-action").click()
  await expect(chi).not.toContainText("Disabled")

  // Platform → Settings: a sender saved here wins over the server's, and Clear goes back to it.
  await page.goto("/platform/settings")
  const sender = page.getByTestId("operator-setting-mailFrom")
  await expect(page.getByTestId("operator-source-mailFrom")).toHaveText("Server setting")
  await sender.getByTestId("operator-input-mailFrom").fill("YaroPay Ops <ops@example.test>")
  await sender.getByTestId("operator-save-mailFrom").click()
  await expect(page.getByTestId("operator-source-mailFrom")).toHaveText("Saved here")
  await expect(page.getByTestId("operator-current-mailFrom")).toHaveText("YaroPay Ops <ops@example.test>")
  await sender.getByTestId("operator-clear-mailFrom").click()
  await expect(page.getByTestId("operator-source-mailFrom")).toHaveText("Server setting")
  // Secrets are never shown: an unset email server says so.
  await expect(page.getByTestId("operator-current-smtpUrl")).toHaveText("nothing")
  // Grouped under headings; numbers show their unit, and a choice is picked from a list.
  await expect(page.getByTestId("operator-group-limits").getByRole("heading", { name: "Limits & timeouts" })).toBeVisible()
  const timeout = page.getByTestId("operator-setting-gatewayTimeoutMs")
  await timeout.getByTestId("operator-input-gatewayTimeoutMs").fill("20000")
  await timeout.getByTestId("operator-save-gatewayTimeoutMs").click()
  await expect(page.getByTestId("operator-current-gatewayTimeoutMs")).toHaveText("20,000 ms")
  await timeout.getByTestId("operator-clear-gatewayTimeoutMs").click()
  await expect(page.getByTestId("operator-source-gatewayTimeoutMs")).toHaveText("Server setting")
  const logLevel = page.getByTestId("operator-setting-logLevel")
  await logLevel.getByTestId("operator-input-logLevel").click()
  await page.getByRole("option", { name: "warn" }).click()
  await logLevel.getByTestId("operator-save-logLevel").click()
  await expect(page.getByTestId("operator-current-logLevel")).toHaveText("warn")
  await logLevel.getByTestId("operator-clear-logLevel").click()
  await expect(page.getByTestId("operator-source-logLevel")).toHaveText("Server setting")

  // Everything above is in the platform audit log.
  await page.goto("/platform/audit")
  for (const action of ["Changed a server setting", "Disabled an account", "Deleted a workspace", "Created a workspace", "Opened a support view", "Opened sign-ups", "Changed exchange rates", "Changed a plan's price", "Changed a workspace's billing"]) {
    await expect(page.getByRole("cell", { name: new RegExp(action) }).first()).toBeVisible()
  }
})
