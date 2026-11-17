import { z } from "zod"
import type { Mode } from "../types.ts"
import type { CredentialField, GatewayDefinition } from "./types.ts"

function fieldSchema(field: CredentialField, mode: Mode) {
  let s = z.string().trim()
  if (field.required) s = s.min(1, `${field.label} is required`)
  if (field.minLength) {
    s = s.min(field.minLength, `${field.label} looks too short`)
  }
  const expected = field.prefix?.[mode]
  if (expected) {
    s = s.refine((v) => v.startsWith(expected), {
      message: `Use your ${mode} ${field.label.toLowerCase()}: it starts with ${expected}`,
    })
  }
  return field.required ? s : s.optional().or(z.literal(""))
}

/** Builds a zod schema for a gateway's credential form in the given mode. */
export function buildCredentialSchema(def: GatewayDefinition, mode: Mode) {
  const shape: Record<string, z.ZodType<string | undefined>> = {}
  for (const field of def.credentialFields) shape[field.key] = fieldSchema(field, mode)
  return z.object(shape)
}

export const connectionInputSchema = z.object({
  gatewayId: z.string().min(1),
  label: z.string().trim().min(2, "Give this account a name").max(48),
  mode: z.enum(["test", "live"]),
  credentials: z.record(z.string(), z.string()),
})

export type ConnectionInput = z.infer<typeof connectionInputSchema>

/** Masks a secret for display: keeps the prefix family and the last 4 characters. */
export function maskSecret(value: string): string {
  if (!value) return ""
  const tail = value.slice(-4)
  const head = value.match(/^[A-Za-z]+[_-](?:test|live|TEST|LIVE)?[_-]?/)?.[0] ?? ""
  return `${head}${"•".repeat(8)}${tail}`
}

export function maskCredentials(def: GatewayDefinition, values: Record<string, string>) {
  const out: Record<string, string> = {}
  for (const field of def.credentialFields) {
    const v = values[field.key] ?? ""
    out[field.key] = field.type === "secret" ? maskSecret(v) : v
  }
  return out
}
