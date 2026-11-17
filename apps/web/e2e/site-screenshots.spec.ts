import { mkdir } from "node:fs/promises"
import { type Page, test } from "@playwright/test"
import sharp from "sharp"

/**
 * Screenshots for yaropay.com, taken from the real dashboard with the sample data, in light and dark.
 * Run from the repository root with `npm run screenshots`; the images land in ../yaropay-site/public/screenshots
 * (the website's repository, checked out next to this one) unless SITE_SCREENSHOTS names another folder.
 */
const OUT = process.env.SITE_SCREENSHOTS

// Marketing shots show the product, not the sample-data scaffolding around it.
const CLEAN = `[data-testid="sample-banner"],[data-testid="setup-checklist"],[title^="Sample data"],[data-sonner-toaster]{display:none!important}`

const SHOTS: { name: string; path: string; prepare?: (page: Page) => Promise<void> }[] = [
  { name: "dashboard", path: "/" },
  {
    name: "transactions",
    path: "/transactions",
    prepare: async (page) => {
      await page.locator("tbody tr").first().click()
      await page.getByRole("dialog").waitFor()
    },
  },
  { name: "integration", path: "/products/prd_shopwise?tab=integration" },
  { name: "webhooks", path: "/webhooks?tab=deliveries" },
  { name: "products", path: "/products" },
  { name: "gateway", path: "/apps/con_ps_main" },
  { name: "team", path: "/settings?tab=team" },
  { name: "tour", path: "/welcome" },
]

test.describe("website screenshots", () => {
  test.skip(!OUT, "Set SITE_SCREENSHOTS=<folder> to capture screenshots for the website")
  test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })

  for (const theme of ["light", "dark"] as const) {
    test(`capture (${theme})`, async ({ page }) => {
      test.setTimeout(120_000)
      await mkdir(OUT!, { recursive: true })
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" })
      for (const shot of SHOTS) {
        await page.goto(shot.path)
        await page.addStyleTag({ content: CLEAN })
        await page.waitForLoadState("networkidle")
        if (shot.prepare) await shot.prepare(page)
        await page.waitForTimeout(600)
        const png = await page.screenshot()
        await sharp(png).webp({ quality: 82 }).toFile(`${OUT}/${shot.name}-${theme}.webp`)
      }
    })
  }
})
