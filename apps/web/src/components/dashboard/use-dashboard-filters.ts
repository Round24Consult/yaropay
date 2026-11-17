"use client"

import { useQueryStates } from "nuqs"
import { useMode } from "@/lib/mode"
import { dashboardFilters } from "@/lib/filters"

/** Dashboard filter state lives in the URL, so every view can be shared as a link. */
export function useDashboardFilters(scope?: { product?: string }) {
  const [filters, setFilters] = useQueryStates(dashboardFilters, { history: "replace" })
  const { mode } = useMode()
  const products = scope?.product ? [scope.product] : filters.product
  const params = {
    period: filters.period,
    from: filters.period === "custom" ? filters.from : undefined,
    to: filters.period === "custom" ? filters.to : undefined,
    product: products,
    gateway: filters.gateway,
    currency: filters.currency,
    granularity: filters.granularity ?? undefined,
    mode,
  }
  return { filters, setFilters, params, scoped: !!scope?.product }
}
