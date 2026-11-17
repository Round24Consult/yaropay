import { expect, test } from "@playwright/test"

test("installing a gateway account generates its webhook URL", async ({ page }) => {
  await page.goto("/apps")
  const card = page.getByTestId("gateway-paystack")
  await card.getByRole("button", { name: "Add another account" }).click()

  const dialog = page.getByRole("dialog")
  await dialog.getByLabel("Account name").fill("Subsidiary")
  // Live mode rejects test keys with a clear message.
  await dialog.getByRole("radio", { name: "live" }).click()
  await dialog.getByLabel("Public key").fill("pk_test_1234567890abcdef1234")
  await dialog.getByLabel("Secret key").fill("sk_test_1234567890abcdef1234")
  await dialog.getByTestId("install-submit").click()
  await expect(dialog.getByText("Use your live secret key: it starts with sk_live_")).toBeVisible()

  await dialog.getByRole("radio", { name: "test" }).click()
  await dialog.getByTestId("install-submit").click()

  await expect(dialog.getByText("Paystack is installed")).toBeVisible()
  await expect(dialog.getByTestId("gateway-webhook-url")).toHaveText(
    /^https:\/\/payments\.company-a\.com\/v1\/webhooks\/paystack\/con_[a-z0-9]+$/,
  )
  await dialog.getByTestId("install-done").click()
  await expect(card.getByText("Subsidiary")).toBeVisible()
})
