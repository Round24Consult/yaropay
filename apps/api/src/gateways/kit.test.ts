import { describe, expect, it } from "vitest"
import { errorMessage, GatewayError, gatewayRequest } from "./kit.js"
import { fakeGateway } from "./testing/fake-gateway.js"

describe("gateway kit", () => {
  it("reads the error message wherever the gateway puts it", () => {
    expect(errorMessage({ message: "Invalid key" })).toBe("Invalid key")
    expect(errorMessage({ error: { message: "No such checkout.session", type: "invalid_request_error" } })).toBe("No such checkout.session")
    expect(errorMessage({ error: "invalid_client", error_description: "Client Authentication failed" })).toBe("Client Authentication failed")
    expect(errorMessage({ requestSuccessful: false, responseMessage: "Duplicate payment reference" })).toBe("Duplicate payment reference")
    expect(errorMessage({ error: "invalid_token" })).toBe("invalid_token")
    expect(errorMessage({ status: false })).toBeNull()
    expect(errorMessage(null)).toBeNull()
  })

  it("turns a gateway's error body into a GatewayError carrying its message", async () => {
    const gw = fakeGateway({ "POST /v1/thing": { status: 400, body: { error: { message: "Amount must be at least 50 cents" } } } })
    const err = await gatewayRequest(gw.ctx, "Stripe", "/v1/thing", { method: "POST", form: { a: "1" } }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(GatewayError)
    expect((err as GatewayError).message).toBe("Stripe: Amount must be at least 50 cents")
    expect((err as GatewayError).status).toBe(400)
  })
})
