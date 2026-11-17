import { expect, test } from "@playwright/test"

test("the Licence tab shows the edition and what each paid feature needs", async ({ page }) => {
  await page.goto("/settings?tab=licence")
  const edition = page.getByTestId("edition-panel")
  await expect(edition).toContainText("YaroPay Community")
  await expect(edition.getByRole("link", { name: /Compare editions/ })).toHaveAttribute("href", "https://yaropay.com/#pricing")
  // Community takes no licence key.
  await expect(page.getByLabel(/Licence key/)).toHaveCount(0)
  for (const feature of ["sso", "custom_roles", "multi_workspace"]) {
    const row = page.getByTestId(`feature-${feature}`)
    await expect(row).toHaveAttribute("data-enabled", "false")
    await expect(row).toContainText("Enterprise")
  }
})
