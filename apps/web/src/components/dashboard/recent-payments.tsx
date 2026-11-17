"use client"

import { ArrowRight } from "lucide-react"
import Link from "next/link"
import { AnimatePresence, motion } from "motion/react"
import { GatewayMark } from "@/components/shared/gateway-mark"
import { Panel, PanelHeader } from "@/components/shared/page-header"
import { ProductChip } from "@/components/shared/product-chip"
import { TransactionStatusBadge } from "@/components/shared/status-badge"
import { Skeleton } from "@/components/ui/skeleton"
import { formatMoney } from "@yaropay/core/money"
import type { ColorSlot } from "@yaropay/core/types"
import { useTransactions } from "@/lib/api/hooks"
import { channelLabel, formatDateTime } from "@/lib/format"
import { useMode } from "@/lib/mode"

export function RecentPayments({ products, scope }: { products: { id: string; name: string; colorSlot: ColorSlot }[]; scope: string[] }) {
  const { mode } = useMode()
  const { data, dataUpdatedAt } = useTransactions({ mode, product: scope, pageSize: 8, period: "all" }, { live: true })
  return (
    <Panel>
      <PanelHeader
        title={
          <span className="flex items-center gap-2">
            Recent payments
            <span className="relative flex size-2" title={dataUpdatedAt ? `Updated ${new Date(dataUpdatedAt).toLocaleTimeString()}` : undefined}>
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-good opacity-60 motion-reduce:hidden" />
              <span className="relative inline-flex size-2 rounded-full bg-good" />
            </span>
            <span className="text-xs font-normal text-muted-foreground">Live</span>
          </span>
        }
        description="New payments appear here as gateways report them"
        actions={
          <Link
            href={scope.length ? `/transactions?product=${scope.join(",")}` : "/transactions"}
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            All transactions <ArrowRight className="size-3" />
          </Link>
        }
      />
      <div className="p-2 pt-3">
        {!data ? (
          <div className="space-y-2 p-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : (
          <ul className="divide-y">
            <AnimatePresence initial={false}>
              {data.rows.map((t) => {
                const p = products.find((x) => x.id === t.productId)
                return (
                  <motion.li
                    key={t.id}
                    layout
                    initial={{ opacity: 0, y: -6, backgroundColor: "color-mix(in oklch, var(--primary) 8%, transparent)" }}
                    animate={{ opacity: 1, y: 0, backgroundColor: "rgba(0,0,0,0)" }}
                    transition={{ duration: 0.6 }}
                    className="rounded-lg"
                  >
                    <Link
                      href={`/transactions?tx=${t.id}&period=all`}
                      className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 rounded-lg px-3 py-2.5 hover:bg-muted/50 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto_auto_auto]"
                    >
                      <div className="flex min-w-0 items-center gap-2.5">
                        <GatewayMark gatewayId={t.gatewayId} size="sm" />
                        <div className="min-w-0">
                          <p className="truncate font-mono text-xs">{t.reference}</p>
                          <p className="truncate text-xs text-muted-foreground">{t.customer.email}</p>
                        </div>
                      </div>
                      <div className="hidden min-w-0 sm:block">{p && <ProductChip name={p.name} slot={p.colorSlot} size="sm" />}</div>
                      <span className="hidden text-xs text-muted-foreground sm:block">{channelLabel(t.channel)}</span>
                      <div className="hidden sm:block">
                        <TransactionStatusBadge status={t.status} />
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-medium tabular">{formatMoney(t.amount, t.currency)}</p>
                        <p className="text-[11px] text-muted-foreground">{formatDateTime(t.createdAt)}</p>
                      </div>
                    </Link>
                  </motion.li>
                )
              })}
            </AnimatePresence>
          </ul>
        )}
      </div>
    </Panel>
  )
}
