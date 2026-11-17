import type { FieldValues, Path, UseFormReturn } from "react-hook-form"
import { ApiRequestError } from "@/lib/api/client"

/**
 * Maps an API error onto a form: field errors go to their inputs, anything else
 * is returned as a form-level message (null when every error found a field).
 */
export function applyApiErrors<T extends FieldValues>(
  form: UseFormReturn<T>,
  err: unknown,
  fallback = "Something went wrong. Try again.",
): string | null {
  if (err instanceof ApiRequestError) {
    const fields = Object.entries(err.fields ?? {})
    const known = new Set(Object.keys(form.getValues()))
    let unplaced = false
    for (const [key, message] of fields) {
      if (known.has(key)) form.setError(key as Path<T>, { message })
      else unplaced = true
    }
    if (fields.length && !unplaced) return null
    return err.message || fallback
  }
  return err instanceof Error && err.message ? err.message : fallback
}

/** Only same-site paths are allowed as a post-login destination. */
export function safeNext(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return "/"
  if (/^\/(login|setup|invite|reset-password|forgot-password)\b/.test(value)) return "/"
  return value
}

/**
 * Leaves an auth page with a full page load. The client router may hold
 * prefetches made while signed out (redirects to /login); a soft navigation
 * would replay them.
 */
export function navigateAfterAuth(url: string) {
  window.location.replace(url)
}
