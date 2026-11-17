import { canSeeProduct } from "@yaropay/core/auth"
import { inArray, type SQL, sql } from "drizzle-orm"
import type { AnyPgColumn } from "drizzle-orm/pg-core"
import { notFound } from "../common/errors.js"
import type { Actor } from "./types.js"

/**
 * What a query may see: always exactly one workspace, then either every product in it or a list.
 * There is deliberately no "no filter" value: `"all"` still means "all products in this workspace".
 */
export interface Scope {
  workspaceId: string
  productIds: string[] | "all"
}

/**
 * The member's scope, narrowed to `requested` products if given. An explicit request for a product
 * they can't see yields an empty list (no rows) instead of leaking data.
 */
export function scopeOf(actor: Actor, requested: string[] = []): Scope {
  const allowed = actor.productIds
  if (allowed === null) return { workspaceId: actor.workspaceId, productIds: requested.length ? requested : "all" }
  return { workspaceId: actor.workspaceId, productIds: requested.length ? requested.filter((id) => allowed.includes(id)) : allowed }
}

/** Every product in a workspace: for system work (gateway webhooks, workers) acting for that workspace. */
export function workspaceScope(workspaceId: string): Scope {
  return { workspaceId, productIds: "all" }
}

/** The product part of a scope as a SQL condition; undefined when every product in the workspace is visible. */
export function productCondition(column: AnyPgColumn, scope: Scope): SQL | undefined {
  if (scope.productIds === "all") return undefined
  return scope.productIds.length ? inArray(column, scope.productIds) : sql`false`
}

/** 404 (not 403) so scoped members cannot probe which products exist. */
export function assertProductVisible(actor: Actor, productId: string) {
  if (!canSeeProduct(actor, productId)) throw notFound("Product")
}
