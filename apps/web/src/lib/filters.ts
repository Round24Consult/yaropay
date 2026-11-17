import { parseAsArrayOf, parseAsInteger, parseAsString, parseAsStringLiteral } from "nuqs"

/** URL query-state parsers shared by the dashboard, transactions and webhooks pages. */
export const periodValues = ["today", "7d", "30d", "90d", "ytd", "12m", "custom"] as const
export const granularityValues = ["day", "week", "month"] as const
export const currencyValues = ["NGN", "USD", "GHS", "KES", "ZAR"] as const

export const dashboardFilters = {
  period: parseAsStringLiteral(periodValues).withDefault("30d"),
  from: parseAsString,
  to: parseAsString,
  product: parseAsArrayOf(parseAsString).withDefault([]),
  gateway: parseAsArrayOf(parseAsString).withDefault([]),
  currency: parseAsStringLiteral(currencyValues).withDefault("NGN"),
  granularity: parseAsStringLiteral(granularityValues),
}

export const transactionFilters = {
  q: parseAsString.withDefault(""),
  period: parseAsStringLiteral([...periodValues, "all"] as const).withDefault("30d"),
  from: parseAsString,
  to: parseAsString,
  product: parseAsArrayOf(parseAsString).withDefault([]),
  gateway: parseAsArrayOf(parseAsString).withDefault([]),
  status: parseAsArrayOf(parseAsString).withDefault([]),
  channel: parseAsArrayOf(parseAsString).withDefault([]),
  currency: parseAsString,
  sort: parseAsString.withDefault("-createdAt"),
  page: parseAsInteger.withDefault(1),
  tx: parseAsString,
}
