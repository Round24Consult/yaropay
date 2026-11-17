import { type ArgumentMetadata, Body, type PipeTransform } from "@nestjs/common"
import type { z } from "zod"
import { invalid, zodFields } from "./errors.js"

export class ZodPipe<S extends z.ZodType> implements PipeTransform {
  constructor(private readonly schema: S) {}
  transform(value: unknown, _meta: ArgumentMetadata): z.infer<S> {
    const parsed = this.schema.safeParse(value ?? {})
    if (!parsed.success) throw invalid(zodFields(parsed.error))
    return parsed.data
  }
}

/** `@ZodBody(schema) body: z.infer<typeof schema>` validates and parses the JSON body. */
export const ZodBody = (schema: z.ZodType) => Body(new ZodPipe(schema))
