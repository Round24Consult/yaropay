"use client"

import { AlertTriangle, ArrowRight, Check } from "lucide-react"
import Link from "next/link"
import { Delta } from "@/components/shared/delta"
import { GatewayMark, gatewayName } from "@/components/shared/gateway-mark"
import { Panel, PanelHeader } from "@/components/shared/page-header"
import { Pill } from "@/components/shared/status-badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { OverviewResponse } from "@yaropay/core/analytics"
import { delta, formatCount, formatMoney, formatPercent } from "@yaropay/core/money"
import type { ColorSlot, CurrencyCode, TransactionStatus } from "@yaropay/core/types"
import { seriesVar } from "@/lib/colors"
import { CHANNEL_LABELS, STATUS_LABELS } from "@/lib/format"
import { cn } from "@/lib/utils"

interface ProductMeta {
  id: string
  name: string
  colorSlot: ColorSlot
}

/** Readable label colour on a series fill (white or near-black by luminance). */
const INK: Record<number, string> = { 1: "#fff", 2: "#fff", 3: "#0b0b0b", 4: "#0b0b0b", 5: "#0b0b0b", 6: "#fff", 7: "#fff", 8: "#fff" }

/**
 * "Sales by product": one tall segmented bar (each product's share) and a card
 * per product. Clicking a card scopes the whole dashboard to that product.
 */
export function ProductBreakdown({
  data,
  products,
  currency,
  selected,
  onSelect,
}: {
  data?: OverviewResponse
  products: ProductMeta[]
  currency: CurrencyCode
  selected: string[]
  onSelect: (id: string) => void
}) {
  const slices = (data?.products ?? [])
    .map((s) => ({ ...s, meta: products.find((p) => p.id === s.productId) }))
    .filter((s): s is typeof s & { meta: ProductMeta } => !!s.meta)
  const total = slices.reduce((s, x) => s + x.volume, 0)
  return (
    <Panel>
      <PanelHeader
        title="Sales by product"
        description="Every payment is tied to the product that started it, even when products share one gateway account."
      />
      <div className="space-y-4 p-5">
        {!data ? (
          <Skeleton className="h-7 rounded-md" />
        ) : total === 0 ? (
          <div className="h-7 rounded-md bg-muted" />
        ) : (
          <div className="flex h-7 gap-0.5" role="img" aria-label={slices.map((s) => `${s.meta.name} ${formatPercent(s.volume / total)}`).join(", ")}>
            {slices
              .filter((s) => s.volume > 0)
              .map((s) => {
                const share = s.volume / total
                return (
                  <Tooltip key={s.productId}>
                    <TooltipTrigger asChild>
                      <div
                        className="flex h-full min-w-1 items-center rounded-[4px] px-2 text-[11px] font-semibold transition-[flex-grow] duration-500"
                        style={{ flexGrow: share, backgroundColor: seriesVar(s.meta.colorSlot), color: INK[s.meta.colorSlot] }}
                      >
                        {share >= 0.08 && <span className="truncate">{formatPercent(share, 0)}</span>}
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>
                      {s.meta.name}: {formatMoney(s.volume, currency)} ({formatPercent(share)})
                    </TooltipContent>
                  </Tooltip>
                )
              })}
          </div>
        )}
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]">
          {(data ? slices : products.map((meta) => ({ productId: meta.id, meta, volume: 0, previousVolume: 0, count: 0, successRate: 0 }))).map((s) => {
            const on = selected.includes(s.productId)
            return (
              <button
                key={s.productId}
                type="button"
                onClick={() => onSelect(s.productId)}
                aria-pressed={on}
                className={cn(
                  "group rounded-xl border p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-card",
                  on && "border-foreground/30 bg-accent/40 ring-1 ring-foreground/15",
                )}
                data-testid={`product-card-${s.productId}`}
              >
                <div className="flex items-center gap-2">
                  <span className="size-2.5 rounded-[3px]" style={{ backgroundColor: seriesVar(s.meta.colorSlot) }} aria-hidden />
                  <span className="text-sm font-medium">{s.meta.name}</span>
                  {on ? (
                    <Check className="ml-auto size-3.5 text-foreground" />
                  ) : (
                    <span className="ml-auto text-[11px] text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">Focus</span>
                  )}
                </div>
                {data ? (
                  <>
                    <div className="mt-3 flex items-baseline gap-2">
                      <span className="text-xl font-semibold tracking-tight">{formatMoney(s.volume, currency, { compact: s.volume >= 1e10 })}</span>
                      <Delta value={delta(s.volume, s.previousVolume)} />
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{total ? formatPercent(s.volume / total) : "0%"} of volume</p>
                    <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                      <span>{formatCount(s.count)} payments</span>
                      <span>{formatPercent(s.successRate)} success</span>
                    </div>
                  </>
                ) : (
                  <Skeleton className="mt-3 h-16" />
                )}
              </button>
            )
          })}
        </div>
      </div>
    </Panel>
  )
}

export function GatewaySplit({ data, currency, products }: { data?: OverviewResponse; currency: CurrencyCode; products: ProductMeta[] }) {
  const rows = data?.gateways ?? []
  const total = rows.reduce((s, r) => s + r.volume, 0)
  return (
    <Panel className="flex h-full flex-col">
      <PanelHeader title="Gateway split" description="One account, many products: each gateway's volume split by product" />
      <div className="flex-1 space-y-4 p-5">
        {!data ? (
          <Skeleton className="h-32" />
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No successful payments in this range.</p>
        ) : (
          <>
            <div className="flex h-2 gap-0.5 overflow-hidden rounded-full" aria-hidden>
              {rows.map((r, i) => (
                <div
                  key={r.gatewayId}
                  className="h-full transition-[flex-grow] duration-500"
                  style={{ flexGrow: r.volume, backgroundColor: i === 0 ? "var(--foreground)" : "var(--neutral-mark)" }}
                />
              ))}
            </div>
            <ul className="space-y-4">
              {rows.map((r, i) => {
                const parts = products.filter((p) => r.byProduct[p.id])
                return (
                  <li key={r.gatewayId} className="space-y-2">
                    <div className="flex items-center gap-3">
                      <GatewayMark gatewayId={r.gatewayId} />
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-1.5 text-sm font-medium">
                          <span className="size-2 rounded-full" style={{ backgroundColor: i === 0 ? "var(--foreground)" : "var(--neutral-mark)" }} aria-hidden />
                          {gatewayName(r.gatewayId)}
                        </p>
                        <p className="text-xs text-muted-foreground">{formatCount(r.count)} payments</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-medium tabular">{formatMoney(r.volume, currency, { compact: true })}</p>
                        <p className="text-xs text-muted-foreground tabular">{formatPercent(r.volume / total)}</p>
                      </div>
                    </div>
                    <div className="pl-10">
                      <div className="flex h-1.5 gap-0.5" role="img" aria-label={`${gatewayName(r.gatewayId)} by product: ${parts.map((p) => `${p.name} ${formatPercent(r.byProduct[p.id] / r.volume, 0)}`).join(", ")}`}>
                        {parts.map((p) => (
                          <div key={p.id} className="h-full rounded-full" style={{ flexGrow: r.byProduct[p.id], backgroundColor: seriesVar(p.colorSlot) }} />
                        ))}
                      </div>
                      <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                        {parts.map((p) => (
                          <span key={p.id} className="inline-flex items-center gap-1">
                            <span className="size-1.5 rounded-full" style={{ backgroundColor: seriesVar(p.colorSlot) }} aria-hidden />
                            {p.name} {formatPercent(r.byProduct[p.id] / r.volume, 0)}
                          </span>
                        ))}
                      </p>
                    </div>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </div>
    </Panel>
  )
}

export function ChannelMix({ data, currency }: { data?: OverviewResponse; currency: CurrencyCode }) {
  const rows = data?.channels ?? []
  const max = Math.max(1, ...rows.map((r) => r.volume))
  const total = rows.reduce((s, r) => s + r.volume, 0)
  return (
    <Panel className="flex h-full flex-col">
      <PanelHeader title="Payment channels" description="How customers paid" />
      <div className="flex-1 p-5">
        {!data ? (
          <Skeleton className="h-40" />
        ) : (
          <ul className="space-y-3">
            {rows.map((r) => (
              <li key={r.channel} className="group">
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="font-medium">{CHANNEL_LABELS[r.channel]}</span>
                  <span className="text-muted-foreground tabular">
                    {formatMoney(r.volume, currency, { compact: true })} · {formatPercent(r.volume / total, 0)}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary/80 transition-[width] duration-500 group-hover:bg-primary"
                    style={{ width: `${(r.volume / max) * 100}%` }}
                    title={`${formatCount(r.count)} payments`}
                  />
                </div>
              </li>
            ))}
            {rows.length === 0 && <p className="text-sm text-muted-foreground">No payments in this range.</p>}
          </ul>
        )}
      </div>
    </Panel>
  )
}

const OUTCOME_ORDER: TransactionStatus[] = ["success", "failed", "abandoned", "pending", "reversed"]
const OUTCOME_COLOR: Record<TransactionStatus, string> = {
  success: "var(--good)",
  failed: "var(--critical)",
  abandoned: "var(--neutral-mark)",
  pending: "var(--warning)",
  reversed: "var(--serious)",
}

export function Outcomes({ data }: { data?: OverviewResponse }) {
  const map = new Map((data?.statuses ?? []).map((s) => [s.status, s.count]))
  const total = [...map.values()].reduce((s, v) => s + v, 0)
  return (
    <Panel className="flex h-full flex-col">
      <PanelHeader title="Payment outcomes" description="Every attempt in this range" />
      <div className="flex-1 space-y-4 p-5">
        {!data ? (
          <Skeleton className="h-36" />
        ) : (
          <>
            <div className="flex h-2 gap-0.5 overflow-hidden rounded-full" aria-hidden>
              {OUTCOME_ORDER.filter((s) => map.get(s)).map((s) => (
                <div key={s} className="h-full" style={{ flexGrow: map.get(s), backgroundColor: OUTCOME_COLOR[s] }} />
              ))}
            </div>
            <ul className="space-y-2">
              {OUTCOME_ORDER.map((s) => (
                <li key={s} className="flex items-center gap-2 text-sm">
                  <span className="size-2 rounded-full" style={{ backgroundColor: OUTCOME_COLOR[s] }} aria-hidden />
                  <span>{STATUS_LABELS[s]}</span>
                  <span className="ml-auto text-muted-foreground tabular">{formatCount(map.get(s) ?? 0)}</span>
                  <span className="w-12 text-right text-xs text-muted-foreground tabular">
                    {total ? formatPercent((map.get(s) ?? 0) / total, 1) : "–"}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Panel>
  )
}

export function WebhookHealth({ data }: { data?: OverviewResponse }) {
  const w = data?.webhooks
  const total = w ? w.delivered + w.retrying + w.failed : 0
  const rate = total && w ? w.delivered / total : 1
  return (
    <Panel className="flex h-full flex-col">
      <PanelHeader
        title="Webhook health"
        description="Events forwarded to your products"
        actions={
          <Link href="/webhooks" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
            Open <ArrowRight className="size-3" />
          </Link>
        }
      />
      <div className="flex-1 space-y-4 p-5">
        {!w ? (
          <Skeleton className="h-36" />
        ) : (
          <>
            <div className="flex items-baseline gap-2">
              <span className="text-[1.65rem] leading-none font-semibold tracking-tight">{formatPercent(rate)}</span>
              <span className="text-sm text-muted-foreground">delivered first time or on retry</span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <Stat label="Delivered" value={w.delivered} />
              <Stat label="Retrying" value={w.retrying} warn={w.retrying > 0} />
              <Stat label="Failed" value={w.failed} danger={w.failed > 0} />
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>p95 latency</span>
              <span className="font-medium text-foreground tabular">{w.p95LatencyMs} ms</span>
            </div>
            {w.unrouted > 0 ? (
              <Link href="/webhooks?tab=incoming&routing=unrouted" className="block">
                <Pill tone="warning" icon={AlertTriangle} className="w-full justify-start rounded-lg py-3.5">
                  {w.unrouted} unrouted event{w.unrouted > 1 ? "s" : ""} need review
                </Pill>
              </Link>
            ) : (
              <Pill tone="good" icon={Check}>
                Every event matched a product
              </Pill>
            )}
          </>
        )}
      </div>
    </Panel>
  )
}

function Stat({ label, value, warn, danger }: { label: string; value: number; warn?: boolean; danger?: boolean }) {
  return (
    <div className="rounded-lg border px-2 py-2">
      <p
        className={cn(
          "text-base font-semibold tabular",
          warn && "text-warning-text",
          danger && "text-critical-text",
        )}
      >
        {formatCount(value)}
      </p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  )
}

