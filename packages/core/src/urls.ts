/**
 * Every URL the platform hands out is derived from the install's public base
 * URL (Settings > General). Changing the base URL changes all of them.
 */
export function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "")
  if (!/^https?:\/\//i.test(trimmed)) return `https://${trimmed}`
  return trimmed
}

/** Paste into the gateway dashboard once per installed account. */
export function gatewayWebhookUrl(baseUrl: string, gatewayId: string, connectionId: string) {
  return `${normalizeBaseUrl(baseUrl)}/v1/webhooks/${gatewayId}/${connectionId}`
}

/** Fallback callback for the gateway dashboard (used when a transaction has none). */
export function gatewayCallbackUrl(baseUrl: string, gatewayId: string, connectionId: string) {
  return `${normalizeBaseUrl(baseUrl)}/v1/callback/${gatewayId}/${connectionId}`
}

/**
 * Per product and gateway: the callback_url / redirect_url for this product's
 * payments. YaroPay verifies the payment there, then redirects the customer to
 * the product's success, failure or cancel URL.
 */
export function productCallbackUrl(baseUrl: string, productId: string, gatewayId: string) {
  return `${normalizeBaseUrl(baseUrl)}/v1/callback/${productId}/${gatewayId}`
}

/** Cancel landing for gateways that support a separate cancel URL (Paystack cancel_action). */
export function productCancelUrl(baseUrl: string, productId: string, gatewayId: string) {
  return `${productCallbackUrl(baseUrl, productId, gatewayId)}?outcome=cancelled`
}

/** The product's server calls this to create a payment. */
export function productPaymentsEndpoint(baseUrl: string, productId: string) {
  return `${normalizeBaseUrl(baseUrl)}/v1/products/${productId}/payments`
}

export const PLATFORM_SIGNATURE_HEADER = "x-yaropay-signature"

export function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:"
  } catch {
    return false
  }
}

export function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value)
    return u.protocol === "https:" || u.protocol === "http:"
  } catch {
    return false
  }
}

/**
 * Where a customer can be sent after paying: a web URL, or an app deep link
 * such as `myapp://payment/success` for mobile products.
 */
export function isRedirectTarget(value: string): boolean {
  if (isHttpUrl(value)) return true
  const m = /^([a-z][a-z0-9+.-]*):\/\/\S+$/i.exec(value.trim())
  return !!m && !["javascript", "data", "file", "vbscript"].includes(m[1].toLowerCase())
}
