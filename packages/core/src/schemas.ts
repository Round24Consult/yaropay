import { z } from "zod"
import type { CurrencyCode } from "./currencies.ts"
import { SUPPORTED_CURRENCIES } from "./gateways/registry.ts"
import { isValidPrefix } from "./routing.ts"
import { isHttpUrl, isHttpsUrl, isRedirectTarget } from "./urls.ts"

const url = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .refine(isHttpUrl, `${label} must be a full URL starting with https://`)

export const productDetailsSchema = z.object({
  name: z.string().trim().min(2, "Name is required").max(40),
  kind: z.enum(["website", "saas", "mobile", "other"]),
  websiteUrl: url("Website URL"),
  colorSlot: z.number().int().min(1).max(8),
  referencePrefix: z
    .string()
    .trim()
    .toUpperCase()
    .refine(isValidPrefix, "2 to 6 capital letters or digits, starting with a letter"),
})

export const productGatewaysSchema = z.object({
  gateways: z
    .array(z.object({ connectionId: z.string(), isDefault: z.boolean() }))
    .min(1, "Attach at least one payment gateway")
    .refine((g) => g.filter((x) => x.isDefault).length === 1, "Pick one default gateway"),
})

const redirect = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .refine(isRedirectTarget, `${label} must be a full URL or an app link like myapp://paid`)

export const productUrlsSchema = z.object({
  webhookUrl: url("Webhook URL"),
  successUrl: redirect("Success URL"),
  failureUrl: redirect("Failure URL"),
  cancelUrl: z
    .string()
    .trim()
    .refine((v) => v === "" || isRedirectTarget(v), "Cancel URL must be a full URL or an app link")
    .optional(),
})

export const productInputSchema = productDetailsSchema
  .extend(productGatewaysSchema.shape)
  .extend(productUrlsSchema.shape)

export type ProductInput = z.infer<typeof productInputSchema>

/** Live connections must point at https endpoints. Returns field -> message. */
export function httpsIssues(
  urls: Partial<Record<"webhookUrl" | "successUrl" | "failureUrl" | "cancelUrl", string | undefined>>,
): Record<string, string> {
  const issues: Record<string, string> = {}
  for (const [key, value] of Object.entries(urls)) {
    if (value && !isHttpsUrl(value)) issues[key] = "Live payments need an https:// URL"
  }
  return issues
}

export const settingsSchema = z.object({
  platformName: z.string().trim().min(2).max(32),
  companyName: z.string().trim().min(2).max(64),
  baseUrl: z
    .string()
    .trim()
    .refine(isHttpUrl, "Use the full public URL, e.g. https://payments.company.com"),
  defaultCurrency: z.enum(SUPPORTED_CURRENCIES as [CurrencyCode, ...CurrencyCode[]]),
  /** Empty string or null clears it. A masked value (with •) leaves it unchanged. */
  alertsWebhookUrl: z
    .string()
    .trim()
    .refine((v) => v === "" || v.includes("•") || isHttpsUrl(v), "Use the https:// incoming-webhook URL from Slack, Discord or Teams")
    .nullable(),
})
