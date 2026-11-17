import { expect, test } from "@playwright/test"

test("filtering transactions by product updates rows, counts and the URL", async ({ page }) => {
  await page.goto("/transactions?period=all")
  const total = page.getByTestId("tx-total")
  await expect(total).toContainText("payments")
  const before = Number((await total.textContent())!.replace(/[^0-9].*$/, "").replace(/,/g, ""))

  await page.getByTestId("facet-product").click()
  await page.getByRole("option", { name: /LedgerPro/ }).click()
  await page.keyboard.press("Escape")

  await expect(page).toHaveURL(/product=prd_ledgerpro/)
  await expect(async () => {
    const after = Number((await total.textContent())!.replace(/[^0-9].*$/, "").replace(/,/g, ""))
    expect(after).toBeGreaterThan(0)
    expect(after).toBeLessThan(before)
  }).toPass()
  const rows = page.getByTestId("tx-row")
  await expect(rows.first()).toContainText("LedgerPro")
  for (const text of await rows.allTextContents()) expect(text).toContain("LedgerPro")

  await rows.first().click()
  await expect(page.getByTestId("transaction-sheet")).toContainText("Routing")
  await expect(page).toHaveURL(/tx=txn_/)
})

test("replaying a failed delivery delivers it", async ({ page, request }) => {
  const failedTotal = async () => (await (await request.get("/api/webhooks/deliveries?state=failed&pageSize=1")).json()).total as number
  const before = await failedTotal()
  await page.goto("/webhooks?state=failed")
  const replay = page.locator('[data-testid^="replay-"]').first()
  await expect(replay).toBeVisible()
  const id = (await replay.getAttribute("data-testid"))!.replace("replay-", "")
  await replay.click()
  await expect(page.getByText(/^Delivered to /)).toBeVisible()
  await expect(page.getByTestId(`delivery-${id}`)).toHaveCount(0)

  expect(await failedTotal()).toBe(before - 1)
})
