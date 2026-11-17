import { expect, test } from "@playwright/test"

test("creating a product gives per-gateway callback URLs that follow the base URL", async ({ page, request }) => {
  const name = `Product B ${Date.now() % 10000}`
  // Our own live account: the wizard never offers the sample accounts to a real product.
  const install = await request.post("/api/connections", {
    data: {
      gatewayId: "paystack",
      label: `Live ${Date.now() % 10000}`,
      mode: "live",
      credentials: { publicKey: "pk_live_e2e1234567890abcdef", secretKey: "sk_live_e2e1234567890abcdef" },
    },
  })
  expect(install.status()).toBe(201)
  const { id: connectionId } = (await install.json()) as { id: string }
  await page.goto("/products/new")

  await page.getByLabel("Product name").fill(name)
  await page.getByLabel("Website or app URL").fill("https://product-b.com")
  await expect(page.getByLabel("Reference prefix")).not.toHaveValue("")
  await page.getByTestId("wizard-next").click()

  await expect(page.getByTestId("attach-con_ps_main")).toHaveCount(0)
  await page.getByTestId(`attach-${connectionId}`).click()
  await page.getByTestId("wizard-next").click()

  // Live account attached: an http webhook is refused.
  await page.getByLabel("Webhook endpoint").fill("http://product-b.com/api/payments/webhook")
  await page.getByLabel("Success page").fill("https://product-b.com/thanks")
  await page.getByLabel("Failure page").fill("https://product-b.com/failed")
  await page.getByTestId("wizard-next").click()
  await expect(page.getByText("Live payments need an https:// webhook URL")).toBeVisible()
  await page.getByLabel("Webhook endpoint").fill("https://product-b.com/api/payments/webhook")
  await page.getByTestId("wizard-next").click()

  await page.getByTestId("wizard-create").click()
  await expect(page.getByText(`${name} is ready`)).toBeVisible()
  const callback = page.getByTestId("callback-url-paystack")
  await expect(callback).toHaveText(/^https:\/\/payments\.company-a\.com\/v1\/callback\/prd_[a-z0-9]+\/paystack$/)
  await expect(page.getByTestId("api-key")).toHaveText(/^ypk_live_[a-z0-9]{32}$/)
  const productId = (await callback.textContent())!.split("/")[5]

  // Changing the base URL in Settings changes every generated URL.
  await page.goto("/settings")
  await page.getByTestId("base-url").fill("https://pay.example.org")
  await page.getByTestId("save-settings").click()
  await expect(page.getByText("Settings saved")).toBeVisible()

  await page.goto(`/products/${productId}?tab=integration`)
  await expect(page.getByTestId("callback-url-paystack")).toHaveText(`https://pay.example.org/v1/callback/${productId}/paystack`)

  await request.patch("/api/settings", { data: { baseUrl: "https://payments.company-a.com" } })
})
