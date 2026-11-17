import { expect, test } from "@playwright/test"

// Runs after every other spec (see the "sample-removal" project): it deletes the sample company they rely on.
test("removing sample data keeps the products and accounts the team created", async ({ page, request }) => {
  const own = ((await (await request.get("/api/products")).json()) as { name: string; sample: boolean }[]).filter((p) => !p.sample)
  expect(own.length).toBeGreaterThan(0)

  await page.goto("/products")
  await page.getByTestId("sample-banner").getByTestId("remove-sample").click()
  const dialog = page.getByRole("dialog")
  await expect(dialog).toContainText("Your own products, gateway accounts, settings and team stay as they are.")
  await dialog.getByTestId("confirm-remove-sample").click()
  await expect(page.getByText("Sample data removed")).toBeVisible()
  await expect(page.getByTestId("sample-banner")).toHaveCount(0)

  await expect(page.getByTestId("product-shopwise")).toHaveCount(0)
  for (const p of own) await expect(page.getByText(p.name, { exact: true }).first()).toBeVisible()

  // An install with real data can't take sample data again.
  await page.goto("/settings")
  const panel = page.getByTestId("sample-panel")
  await expect(panel).toContainText("only be loaded into an empty install")
  await expect(panel.getByTestId("load-sample")).toBeDisabled()
})
