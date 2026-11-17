import { createHmac } from "node:crypto"
import { expect, test } from "@playwright/test"
import { E2E_OWNER } from "./test-users"

test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test("redirects to sign-in and signs the owner in", async ({ page }) => {
    await page.goto("/transactions")
    await expect(page).toHaveURL(/\/login\?next=%2Ftransactions/)
    await page.getByLabel("Email").fill(E2E_OWNER.email)
    await page.getByLabel("Password", { exact: true }).fill("not-the-password")
    await page.getByTestId("login-submit").click()
    await expect(page.getByText("That email and password don't match an account.")).toBeVisible()
    await page.getByLabel("Password", { exact: true }).fill(E2E_OWNER.password)
    await page.getByTestId("login-submit").click()
    await expect(page).toHaveURL(/\/transactions$/)
    await expect(page.getByTestId("tx-total")).toBeVisible()
  })
})

test("an invited viewer joins with a link and gets read-only screens", async ({ page, browser }) => {
  const email = `viewer${Date.now() % 100000}@company-a.test`
  await page.goto("/settings?tab=team")
  await page.getByTestId("invite-member").click()
  const dialog = page.getByRole("dialog")
  await dialog.getByLabel("Email").fill(email)
  await dialog.locator("#invite-role").click()
  await page.getByRole("option", { name: "Viewer" }).click()
  await dialog.getByTestId("send-invite").click()
  const link = page.getByTestId("invite-url")
  await expect(link).toHaveText(/\/invite\/[\w-]{20,}$/)
  const path = new URL((await link.textContent())!).pathname

  const viewerContext = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  const viewer = await viewerContext.newPage()
  await viewer.goto(path)
  await expect(viewer.getByText(email)).toBeVisible()
  await viewer.getByLabel("Your name").fill("Kofi Viewer")
  await viewer.getByLabel("Password", { exact: true }).fill("viewer-password-123")
  await viewer.getByRole("button", { name: "Accept invite" }).click()
  await expect(viewer).toHaveURL(/\/$/)

  await viewer.goto("/products")
  await expect(viewer.getByText("Shopwise").first()).toBeVisible()
  await expect(viewer.getByRole("link", { name: /New product/ })).toHaveCount(0)
  await expect(viewer.getByRole("button", { name: /New product/ })).toHaveCount(0)
  await viewer.goto("/settings")
  await expect(viewer.getByTestId("base-url")).toBeDisabled()
  await viewerContext.close()

  await page.goto("/settings?tab=team")
  await expect(page.getByTestId(`member-${email}`)).toContainText("Kofi Viewer")
})

test("an unrouted gateway event shows up in the notification bell", async ({ page, request }) => {
  await page.goto("/")
  const bell = page.getByTestId("notification-bell")
  await expect(bell).toBeVisible()
  // Read everything first so the new one stands out.
  await request.post("/api/notifications/read-all")
  await page.reload()
  await expect(bell).toHaveAttribute("aria-label", "Notifications")

  // A signed Paystack event for a payment made outside YaroPay (no prefix, no metadata).
  const body = JSON.stringify({ event: "charge.success", data: { id: 99, reference: `T${Date.now()}`, amount: 990000, currency: "NGN", metadata: {} } })
  const signature = createHmac("sha512", "sk_live_demo8d1e6c3b9a2f7e4d0c5b8a1f").update(body).digest("hex")
  const res = await request.post("/v1/webhooks/paystack/con_ps_main", { headers: { "content-type": "application/json", "x-paystack-signature": signature }, data: body })
  expect(await res.json()).toMatchObject({ received: true, routed: false })

  await expect(bell).toHaveAttribute("aria-label", /1 unread/)
  await bell.click()
  await expect(page.getByRole("button", { name: /Unrouted Paystack event/ })).toBeVisible()
})
