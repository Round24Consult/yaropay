import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { SettingsService } from "../src/settings/settings.service.js"
import { createProduct, createTestApp, FLUTTERWAVE_TEST, installGateway, PAYSTACK_TEST, setupOwner, type TestApp } from "./helpers.js"

/**
 * An install's operator can stop offering a gateway (Platform → Gateways on Cloud). New accounts on it are
 * refused; accounts already connected keep taking payments and stay manageable.
 */
describe("gateways the install doesn't offer", () => {
  let t: TestApp
  let owner: ReturnType<TestApp["agent"]>
  let connectionId: string
  let product: Awaited<ReturnType<typeof createProduct>>

  beforeEach(async () => {
    t = await createTestApp()
    owner = (await setupOwner(t)).agent
    connectionId = (await installGateway(owner, "paystack")).id
    product = await createProduct(owner, connectionId)
    await t.app.get(SettingsService).setGatewayOffered("paystack", false)
  })
  afterEach(() => t.close())

  it("marks the gateway as not offered in the Apps list", async () => {
    const list = (await owner.get("/api/gateways").expect(200)).body as { gateway: { id: string }; offered: boolean; connections: unknown[] }[]
    expect(list.find((i) => i.gateway.id === "paystack")).toMatchObject({ offered: false, connections: [expect.objectContaining({ id: connectionId })] })
    expect(list.find((i) => i.gateway.id === "flutterwave")).toMatchObject({ offered: true })
  })

  it("refuses new accounts and key tests with a clear 422, and allows them again once offered", async () => {
    const add = await owner.post("/api/connections").send({ gatewayId: "paystack", label: "Second", mode: "test", credentials: PAYSTACK_TEST }).expect(422)
    expect(add.body.error).toMatchObject({ code: "gateway_turned_off", message: expect.stringContaining("Accounts already connected keep working") })
    const test = await owner.post("/api/connections/test").send({ gatewayId: "paystack", mode: "test", credentials: PAYSTACK_TEST }).expect(422)
    expect(test.body.error.code).toBe("gateway_turned_off")

    // Other gateways are unaffected.
    await owner.post("/api/connections").send({ gatewayId: "flutterwave", label: "FW", mode: "test", credentials: FLUTTERWAVE_TEST }).expect(201)

    await t.app.get(SettingsService).setGatewayOffered("paystack", true)
    await owner.post("/api/connections").send({ gatewayId: "paystack", label: "Second", mode: "test", credentials: PAYSTACK_TEST }).expect(201)
  })

  it("keeps existing accounts working: payments start and settle, and keys can still be updated", async () => {
    const started = await t
      .http()
      .post(`/v1/products/${product.product.id}/payments`)
      .set("authorization", `Bearer ${product.testApiKey}`)
      .send({ amount: 250_000, currency: "NGN", email: "ada@example.test" })
      .expect(201)
    const { reference } = started.body
    t.net.setStatus(reference, "success")
    const cb = await t.http().get(`/v1/callback/${product.product.id}/paystack?reference=${reference}`).expect(303)
    expect(new URL(cb.headers.location).searchParams.get("status")).toBe("success")

    await owner.patch(`/api/connections/${connectionId}`).send({ label: "Renamed", credentials: PAYSTACK_TEST }).expect(200)
  })

  it("is idempotent and keeps the list tidy", async () => {
    const settings = t.app.get(SettingsService)
    expect(await settings.setGatewayOffered("paystack", false)).toEqual(["paystack"])
    expect(await settings.setGatewayOffered("flutterwave", false)).toEqual(["paystack", "flutterwave"])
    expect(await settings.setGatewayOffered("paystack", true)).toEqual(["flutterwave"])
    expect(await settings.setGatewayOffered("paystack", true)).toEqual(["flutterwave"])
  })
})
