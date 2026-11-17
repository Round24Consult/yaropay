import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from "@nestjs/common"
import { ThrottlerException } from "@nestjs/throttler"
import type { Response } from "express"

/** Shapes every error as `{ error: { message, code?, fields? } }`. */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger("Errors")

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>()
    if (res.headersSent) return
    if (exception instanceof ThrottlerException) {
      res.status(429).json({ error: { message: "Too many attempts. Wait a minute and try again.", code: "rate_limited" } })
      return
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus()
      const body = exception.getResponse()
      if (typeof body === "object" && body && "error" in body && typeof (body as { error: unknown }).error === "object") {
        res.status(status).json(body)
        return
      }
      const message =
        typeof body === "string"
          ? body
          : Array.isArray((body as { message?: unknown }).message)
            ? ((body as { message: string[] }).message[0] ?? exception.message)
            : String((body as { message?: string }).message ?? exception.message)
      res.status(status).json({ error: { message, code: status === 404 ? "not_found" : undefined } })
      return
    }
    const err = exception as Error
    // Malformed JSON bodies surface as body-parser errors with a status.
    const status = (exception as { status?: number }).status
    if (status === 400 || status === 413) {
      res.status(status).json({ error: { message: status === 413 ? "Request body is too large" : "Request body must be valid JSON", code: "bad_request" } })
      return
    }
    this.logger.error(err?.stack ?? String(exception))
    res.status(500).json({ error: { message: "Something went wrong on our side", code: "internal" } })
  }
}
