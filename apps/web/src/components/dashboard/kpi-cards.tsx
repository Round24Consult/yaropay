"use client"

import { Delta } from "@/components/shared/delta"
import { Panel } from "@/components/shared/page-header"
import { Sparkline } from "@/components/shared/sparkline"
import { Skeleton } from "@/components/ui/skeleton"
import type { Kpi, OverviewResponse } from "@yaropay/core/analytics"
import { delta, formatCount, formatMoney, formatPercent } from "@yaropay/core/money"
import type { CurrencyCode } from "@yaropay/core/types"
import { useAnimatedNumber } from "@/hooks/use-animated-number"

function KpiCard({
  label,
  kpi,
  format,
  hint,
  testId,
}: {
  label: string
  kpi: Kpi
  format: (n: number) => string
  hint: string
  testId?: string
}) {
  const value = useAnimatedNumber(kpi.current)
  return (
    <Panel className="flex flex-col gap-3 p-5" data-testid={testId}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{label}</p>
        <Delta value={delta(kpi.current, kpi.previous)} />
      </div>
      <p className="text-[1.65rem] leading-none font-semibold tracking-tight">{format(value)}</p>
      <div className="flex items-end justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {hint} {format(kpi.previous)}
        </p>
        <Sparkline values={kpi.trend} className="w-24 shrink-0" height={28} />
      </div>
    </Panel>
  )
}

export function KpiCards({ data, currency }: { data?: OverviewResponse; currency: CurrencyCode }) {
  if (!data) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[138px] rounded-2xl" />
        ))}
      </div>
    )
  }
  const { kpis } = data
  const money = (n: number) => formatMoney(n, currency, { compact: n >= 100_000_000_00 })
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <KpiCard label="Gross volume" kpi={kpis.grossVolume} format={money} hint="vs" testId="kpi-volume" />
      <KpiCard label="Successful payments" kpi={kpis.successfulPayments} format={(n) => formatCount(Math.round(n))} hint="vs" />
      <KpiCard label="Success rate" kpi={kpis.successRate} format={(n) => formatPercent(n)} hint="vs" />
      <KpiCard label="Average order" kpi={kpis.averageOrder} format={(n) => formatMoney(n, currency)} hint="vs" />
    </div>
  )
}
