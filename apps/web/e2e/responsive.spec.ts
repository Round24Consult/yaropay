import { expect, test } from "@playwright/test"

const PAGES = ["/", "/products", "/products/prd_shopwise?tab=integration", "/products/new", "/transactions", "/webhooks", "/apps", "/apps/con_ps_main", "/settings", "/welcome"]
const SHOTS = process.env.SCREENSHOT_DIR

for (const theme of ["light", "dark"] as const) {
  test.describe(`phone width, ${theme}`, () => {
    test.use({ viewport: { width: 390, height: 844 }, colorScheme: theme })
    for (const path of PAGES) {
      test(`no horizontal scroll on ${path}`, async ({ page }) => {
        await page.goto(path)
        await page.waitForLoadState("networkidle")
        await expect(page.locator("#content")).toBeVisible()
        const { scroll, width } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: window.innerWidth }))
        expect(scroll).toBeLessThanOrEqual(width)
        if (SHOTS) await page.screenshot({ path: `${SHOTS}/m-${theme}-${path.replace(/[^a-z0-9]+/gi, "_")}.png`, fullPage: true })
      })
    }
  })
}

test("desktop screenshots", async ({ page }) => {
  test.skip(!SHOTS, "set SCREENSHOT_DIR to capture")
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme })
    for (const path of PAGES) {
      await page.goto(path)
      await page.waitForLoadState("networkidle")
      await page.waitForTimeout(400)
      await page.screenshot({ path: `${SHOTS}/d-${theme}-${path.replace(/[^a-z0-9]+/gi, "_")}.png`, fullPage: true })
    }
  }
})
