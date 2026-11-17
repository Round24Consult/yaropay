export type WidgetId = "kpis" | "revenue" | "gateways" | "products" | "channels" | "outcomes" | "webhooks" | "recent"

export const WIDGETS: { id: WidgetId; title: string; span: string }[] = [
  { id: "kpis", title: "Key metrics", span: "lg:col-span-12" },
  { id: "revenue", title: "Revenue by product", span: "lg:col-span-8" },
  { id: "gateways", title: "Gateway split", span: "lg:col-span-4" },
  { id: "products", title: "Sales by product", span: "lg:col-span-12" },
  { id: "channels", title: "Payment channels", span: "lg:col-span-4" },
  { id: "outcomes", title: "Payment outcomes", span: "lg:col-span-4" },
  { id: "webhooks", title: "Webhook health", span: "lg:col-span-4" },
  { id: "recent", title: "Recent payments", span: "lg:col-span-12" },
]

export interface WidgetLayout {
  order: WidgetId[]
  hidden: WidgetId[]
}

export const DEFAULT_LAYOUT: WidgetLayout = { order: WIDGETS.map((w) => w.id), hidden: [] }
