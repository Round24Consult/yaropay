import { type Browser, expect, type Page, test } from "@playwright/test"
import { totp } from "./totp"

async function signIn(browser: Browser, email: string, password: string): Promise<Page> {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  const page = await context.newPage()
  await page.goto("/login")
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password", { exact: true }).fill(password)
  await page.getByTestId("login-submit").click()
  return page
}

// Uses its own invited member: turning two-step sign-in on signs out the account's other sessions,
// which would break every other spec if it were the shared owner.
test("a member turns on two-step sign-in and then signs in with a code or a recovery code", async ({ page, browser }) => {
  const email = `twostep${Date.now() % 100000}@company-a.test`
  const password = "two-step-password-1"
  await page.goto("/settings?tab=team")
  await page.getByTestId("invite-member").click()
  const invite = page.getByRole("dialog")
  await invite.getByLabel("Email").fill(email)
  await invite.getByTestId("send-invite").click()
  const path = new URL((await page.getByTestId("invite-url").textContent())!).pathname

  const memberContext = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  const member = await memberContext.newPage()
  await member.goto(path)
  await member.getByLabel("Your name").fill("Tolu Twostep")
  await member.getByLabel("Password", { exact: true }).fill(password)
  await member.getByRole("button", { name: "Accept invite" }).click()
  await expect(member).toHaveURL(/\/$/)

  // Set it up from Settings, Security.
  await member.goto("/settings?tab=security")
  await member.getByTestId("mfa-setup-start").click()
  await member.getByTestId("mfa-password").fill(password)
  await member.getByTestId("mfa-password-submit").click()
  const secret = (await member.getByTestId("mfa-secret").textContent())!.replace(/\s/g, "")
  expect(secret).toMatch(/^[A-Z2-7]{32}$/)
  await expect(member.getByRole("img", { name: "QR code for your authenticator app" }).locator("svg")).toBeVisible()
  await member.getByTestId("mfa-enable-code").fill(totp(secret))
  await member.getByTestId("mfa-enable-submit").click()
  const codes = member.getByTestId("recovery-codes").locator("li")
  await expect(codes).toHaveCount(10)
  const recovery = (await codes.first().textContent())!
  await member.getByTestId("recovery-codes-done").click()
  await expect(member.getByTestId("recovery-codes-left")).toHaveText("10 recovery codes left.")
  await memberContext.close()

  // Signing in now asks for a code, even after a reload.
  const withCode = await signIn(browser, email, password)
  await expect(withCode.getByRole("heading", { name: "Two-step sign-in" })).toBeVisible()
  await withCode.reload()
  await expect(withCode.getByRole("heading", { name: "Two-step sign-in" })).toBeVisible()
  const wrong = totp(secret, 1) === "000000" ? "111111" : "000000"
  await withCode.getByTestId("mfa-code").fill(wrong)
  await withCode.getByTestId("mfa-submit").click()
  await expect(withCode.getByText(/That code didn't match/).first()).toBeVisible()
  await withCode.getByTestId("mfa-code").fill(totp(secret, 1))
  await withCode.getByTestId("mfa-submit").click()
  await expect(withCode).toHaveURL(/\/$/)
  await withCode.context().close()

  // Lost phone: a recovery code works once.
  const withRecovery = await signIn(browser, email, password)
  await withRecovery.getByRole("button", { name: "Use a recovery code" }).click()
  await withRecovery.getByTestId("mfa-code").fill(recovery)
  await withRecovery.getByTestId("mfa-submit").click()
  await expect(withRecovery).toHaveURL(/\/$/)
  await withRecovery.goto("/settings?tab=security")
  await expect(withRecovery.getByTestId("recovery-codes-left")).toHaveText("9 recovery codes left.")
  await withRecovery.context().close()
})
