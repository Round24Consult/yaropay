import { expect, type Page, test } from "@playwright/test"
import { E2E_OWNER } from "./test-users"
import { totp } from "./totp"

const edition = process.env.E2E_EDITION ?? "community"
/** Set E2E_SHOTS to a folder to keep screenshots of the AI apps tab. */
const shot = (page: Page, name: string) => (process.env.E2E_SHOTS ? page.screenshot({ path: `${process.env.E2E_SHOTS}/${name}.png`, fullPage: true }) : null)

test("the AI apps tab says what Enterprise and Cloud add, in Community", async ({ page }) => {
  test.skip(edition !== "community", "Community only")
  await page.goto("/settings?tab=ai-apps")
  await expect(page.getByText("Available with YaroPay Enterprise and Cloud")).toBeVisible()
})

// Cloud only. Run with the paid build checked out:
//   E2E_EDITION=cloud npm run e2e -w @yaropay/web -- e2e/ai-apps.spec.ts
test("on Cloud, a member creates an AI app token, the app uses it, and the member revokes it", async ({ page }) => {
  test.skip(edition !== "cloud", "YaroPay Cloud only (E2E_EDITION=cloud)")
  await page.goto("/settings?tab=ai-apps")
  await expect(page.getByTestId("mcp-url")).toBeVisible()
  if (await page.getByTestId("mcp-unavailable").isVisible()) {
    // Not on a Cloud plan yet: the super admin puts the company on Standard (the console needs two-step sign-in).
    await expect(page.getByTestId("mcp-unavailable")).toContainText("plan")
    await page.goto("/platform")
    await expect(page.getByTestId("platform-needs-mfa").or(page.getByTestId("platform-companies"))).toBeVisible()
    if (await page.getByTestId("platform-needs-mfa").isVisible()) {
      await page.goto("/settings?tab=security")
      await page.getByTestId("mfa-setup-start").click()
      await page.getByTestId("mfa-password").fill(E2E_OWNER.password)
      await page.getByTestId("mfa-password-submit").click()
      const secret = (await page.getByTestId("mfa-secret").textContent())!.replace(/\s/g, "")
      await page.getByTestId("mfa-enable-code").fill(totp(secret))
      await page.getByTestId("mfa-enable-submit").click()
      await page.getByTestId("recovery-codes-done").click()
    }
    await page.goto("/platform/companies")
    await page.getByTestId("company-company-a").click()
    await page.getByTestId("billing-plan").click()
    await page.getByRole("option", { name: "Standard" }).click()
    await page.getByTestId("save-billing").click()
    await expect(page.getByText("Billing saved")).toBeVisible()
    await page.goto("/settings?tab=ai-apps")
  }
  await expect(page.getByTestId("mcp-url")).toContainText("/mcp")
  await expect(page.getByTestId("mcp-unavailable")).toHaveCount(0)

  await page.getByTestId("mcp-new-token").click()
  await page.getByLabel("Name").fill("Claude Code on my laptop")
  await page.getByTestId("mcp-create-token").click()
  const token = (await page.getByTestId("mcp-created-token").textContent())!.trim()
  expect(token).toMatch(/^ypmcp_pat_[a-z0-9]{40}$/)
  await shot(page, "ai-apps-token-created")
  await page.getByRole("button", { name: "Done" }).click()
  await expect(page.getByTestId("mcp-connection")).toContainText("Claude Code on my laptop")

  // The app calls YaroPay's MCP server with the token, through the dashboard's own address.
  const res = await page.request.post("/mcp", {
    headers: { authorization: `Bearer ${token}`, accept: "application/json, text/event-stream", "content-type": "application/json", "mcp-protocol-version": "2025-11-25" },
    data: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_connection_info", arguments: {} } },
  })
  expect(res.status()).toBe(200)
  expect(await res.text()).toContain("Company A")

  await page.reload()
  await expect(page.getByTestId("mcp-activity")).toContainText("get_connection_info")
  await page.getByTestId("mcp-control-shareCustomerDetails").click()
  await expect(page.getByText("Customer details shared")).toBeVisible()
  await shot(page, "ai-apps-tab")

  await page.getByTestId("mcp-connection").getByRole("button", { name: "Revoke" }).click()
  await expect(page.getByTestId("mcp-connection")).toHaveCount(0)
  const after = await page.request.post("/mcp", {
    headers: { authorization: `Bearer ${token}`, accept: "application/json, text/event-stream", "content-type": "application/json", "mcp-protocol-version": "2025-11-25" },
    data: { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
  })
  expect(after.status()).toBe(401)
})
