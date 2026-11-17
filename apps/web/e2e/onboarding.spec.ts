import { expect, test } from "@playwright/test"

test("sample data is labelled everywhere and the setup guide can be hidden and brought back", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByTestId("sample-banner")).toContainText("You're exploring sample data.")

  const guide = page.getByTestId("setup-checklist")
  await expect(guide).toBeVisible()
  // The e2e install's base URL is a public https address, so that step is already done.
  await expect(guide.getByTestId("setup-step-base_url")).toHaveAttribute("data-done", "true")
  await guide.getByTestId("setup-step-test_payment").click()
  await expect(guide.getByRole("heading", { name: "Take a test payment" })).toBeVisible()

  await guide.getByTestId("hide-setup").click()
  await expect(guide).toHaveCount(0)
  await page.reload()
  await expect(page.getByTestId("kpi-volume")).toBeVisible()
  await expect(page.getByTestId("setup-checklist")).toHaveCount(0)

  await page.getByTestId("user-menu").click()
  await page.getByTestId("menu-getting-started").click()
  await expect(page.getByTestId("setup-checklist")).toBeVisible()

  await page.goto("/products")
  await expect(page.getByTestId("product-shopwise").getByText("Sample")).toBeVisible()
})

test("the tour walks through the idea and offers both ways to start", async ({ page }) => {
  await page.goto("/welcome")
  await expect(page.getByTestId("tour-slide-1")).toContainText("One gateway account. Every product kept apart.")
  await page.getByTestId("tour-next").click()
  await expect(page.getByTestId("tour-slide-2")).toContainText("Your product never talks to the gateway directly.")
  await page.keyboard.press("ArrowRight")
  const last = page.getByTestId("tour-slide-3")
  await expect(last).toContainText("How do you want to begin?")
  await expect(last).toContainText("Sample data is already loaded.")
  await last.getByRole("button", { name: "Open dashboard" }).click()
  await expect(page).toHaveURL(/\/$/)
})
