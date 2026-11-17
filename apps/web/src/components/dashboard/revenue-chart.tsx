"use client"

import * as React from "react"
import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts"
import { Panel, PanelHeader } from "@/components/shared/page-header"
import { ProductDot } from "@/components/shared/product-chip"
import { ChartContainer, type ChartConfig } from "@/components/ui/chart"
import { Skeleton } from "@/components/ui/skeleton"
import type { Granularity, OverviewResponse } from "@yaropay/core/analytics"
import { formatMoney } from "@yaropay/core/money"
import type { ColorSlot, CurrencyCode } from "@yaropay/core/types"
import { seriesVar } from "@/lib/colors"
import { formatBucket } from "@/lib/format"
import { cn } from "@/lib/utils"

interface ProductMeta {
  id: string
  name: string
  colorSlot: ColorSlot
}

const GRANS: { value: Granularity; label: string }[] = [
  { value: "day", label: "Daily" },
  { value: "week", label: "Weekly" },
  { value: "month", label: "Monthly" },
]

interface TooltipPayload {
  dataKey: string
  value: number
}

function RevenueTooltip({
  active,
  payload,
  label,
  products,
  currency,
  granularity,
}: {
  active?: boolean
  payload?: TooltipPayload[]
  label?: string
  products: ProductMeta[]
  currency: CurrencyCode
  granularity: Granularity
}) {
  if (!active || !payload?.length || !label) return null
  const total = payload.reduce((s, p) => s + (p.value ?? 0), 0)
  const rows = [...payload].reverse()
  return (
    <div className="min-w-52 rounded-xl border bg-popover p-3 text-xs shadow-lg">
      <p className="mb-2 font-medium">{formatBucket(label, granularity, true)}</p>
      <ul className="space-y-1.5">
        {rows.map((p) => {
          const meta = products.find((x) => x.id === p.dataKey)
          if (!meta) return null
          return (
            <li key={p.dataKey} className="flex items-center gap-2">
              <ProductDot slot={meta.colorSlot} />
              <span className="text-muted-foreground">{meta.name}</span>
              <span className="ml-auto font-medium tabular">{formatMoney(p.value, currency)}</span>
            </li>
          )
        })}
      </ul>
      <div className="mt-2 flex items-center justify-between border-t pt-2 font-medium">
        <span>Total</span>
        <span className="tabular">{formatMoney(total, currency)}</span>
      </div>
    </div>
  )
}

/** Stacked columns: each product keeps its colour, so revenue per product reads at a glance. */
export function RevenueChart({
  data,
  products,
  currency,
  granularity,
  onGranularity,
}: {
  data?: OverviewResponse
  products: ProductMeta[]
  currency: CurrencyCode
  granularity: Granularity
  onGranularity: (g: Granularity) => void
}) {
  const [showTable, setShowTable] = React.useState(false)
  const visible = products.filter((p) => data?.series[0] && p.id in data.series[0].values)
  const config = Object.fromEntries(visible.map((p) => [p.id, { label: p.name, color: seriesVar(p.colorSlot) }])) satisfies ChartConfig
  const rows: Record<string, string | number>[] = (data?.series ?? []).map((s) => ({ bucket: s.bucket, ...s.values }))
  const num = (r: Record<string, string | number>, id: string) => Number(r[id] ?? 0)
  const total = rows.reduce((sum, r) => sum + visible.reduce((s, p) => s + num(r, p.id), 0), 0)

  return (
    <Panel className="flex h-full flex-col">
      <PanelHeader
        title="Revenue by product"
        description={data ? `${formatMoney(total, currency)} in successful payments, split by the product that started them` : "Loading…"}
        actions={
          <div role="radiogroup" aria-label="Group by" className="flex h-7 items-center rounded-lg border bg-background p-0.5">
            {GRANS.map((g) => (
              <button
                key={g.value}
                type="button"
                role="radio"
                aria-checked={granularity === g.value}
                onClick={() => onGranularity(g.value)}
                className={cn(
                  "h-full rounded-md px-2 text-xs font-medium",
                  granularity === g.value ? "bg-secondary text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {g.label}
              </button>
            ))}
          </div>
        }
      />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 pt-3" aria-label="Legend">
        {visible.map((p) => (
          <span key={p.id} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="size-2.5 rounded-[3px]" style={{ backgroundColor: seriesVar(p.colorSlot) }} aria-hidden />
            {p.name}
          </span>
        ))}
        <button
          type="button"
          onClick={() => setShowTable((s) => !s)}
          className="ml-auto text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          {showTable ? "Show chart" : "View as table"}
        </button>
      </div>
      <div className="flex-1 px-2 pt-2 pb-3">
        {!data ? (
          <Skeleton className="mx-3 h-[260px] rounded-xl" />
        ) : showTable ? (
          <div className="max-h-[280px] overflow-auto px-3">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-card text-muted-foreground">
                <tr>
                  <th className="py-2 text-left font-medium">Period</th>
                  {visible.map((p) => (
                    <th key={p.id} className="py-2 text-right font-medium">
                      {p.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="tabular">
                {rows.map((r) => (
                  <tr key={String(r.bucket)} className="border-t">
                    <td className="py-1.5">{formatBucket(String(r.bucket), granularity, true)}</td>
                    {visible.map((p) => (
                      <td key={p.id} className="py-1.5 text-right">
                        {formatMoney(num(r, p.id), currency, { decimals: false })}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <ChartContainer config={config} className="aspect-auto h-[270px] w-full">
            <BarChart data={rows} margin={{ top: 8, right: 12, left: 4, bottom: 0 }} barCategoryGap="22%">
              <CartesianGrid vertical={false} stroke="var(--grid)" />
              <XAxis
                dataKey="bucket"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={24}
                tickFormatter={(v: string) => formatBucket(v, granularity)}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                width={56}
                tickFormatter={(v: number) => formatMoney(v, currency, { compact: true })}
              />
              <Tooltip
                cursor={{ fill: "var(--muted)", opacity: 0.6 }}
                content={<RevenueTooltip products={visible} currency={currency} granularity={granularity} />}
              />
              {visible.map((p, i) => (
                <Bar
                  key={p.id}
                  dataKey={p.id}
                  stackId="revenue"
                  fill={seriesVar(p.colorSlot)}
                  stroke="var(--card)"
                  strokeWidth={1}
                  maxBarSize={24}
                  radius={i === visible.length - 1 ? [4, 4, 0, 0] : 0}
                  isAnimationActive
                  animationDuration={500}
                />
              ))}
            </BarChart>
          </ChartContainer>
        )}
      </div>
    </Panel>
  )
}
