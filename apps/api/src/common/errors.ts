import { HttpException, HttpStatus } from "@nestjs/common"
import type { z } from "zod"

/** Every error leaves the API as `{ error: { message, code?, fields? } }`. */
export class ApiException extends HttpException {
  constructor(status: number, message: string, opts: { code?: string; fields?: Record<string, string> } = {}) {
    super({ error: { message, ...(opts.code ? { code: opts.code } : {}), ...(opts.fields ? { fields: opts.fields } : {}) } }, status)
  }
}

export const notFound = (what: string) => new ApiException(HttpStatus.NOT_FOUND, `${what} not found`, { code: "not_found" })
export const forbidden = (message = "You don't have permission to do that") =>
  new ApiException(HttpStatus.FORBIDDEN, message, { code: "forbidden" })
export const unauthenticated = (message = "Sign in to continue") =>
  new ApiException(HttpStatus.UNAUTHORIZED, message, { code: "unauthenticated" })
export const conflict = (message: string) => new ApiException(HttpStatus.CONFLICT, message, { code: "conflict" })
export const badRequest = (message: string) => new ApiException(HttpStatus.BAD_REQUEST, message, { code: "bad_request" })
export const gone = (message: string) => new ApiException(HttpStatus.GONE, message, { code: "gone" })
export const invalid = (fields: Record<string, string>, message = "Some fields need attention") =>
  new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, message, { code: "validation_failed", fields })

export function zodFields(error: z.ZodError, prefix = ""): Record<string, string> {
  const fields: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = prefix + (issue.path.map(String).join(".") || "_")
    fields[key] ??= issue.message
  }
  return fields
}
