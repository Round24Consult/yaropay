"use client"

import Link from "next/link"
import { CopyButton } from "@/components/shared/copy-field"
import { GatewayMark, gatewayName } from "@/components/shared/gateway-mark"
import { ProductChip } from "@/components/shared/product-chip"
import { DeliveryBadge, TransactionStatusBadge } from "@/components/shared/status-badge"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { formatMoney } from "@yaropay/core/money"
import { useProducts, useTransaction } from "@/lib/api/hooks"
import { channelLabel, formatDateTime } from "@/lib/format"
import { RoutingTimeline } from "./routing-timeline"

export function TransactionSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data: tx, isLoading } = useTransaction(id)
  const { data: products = [] } = useProducts()
  const product = products.find((p) => p.id === tx?.productId)
  return (
    <Sheet open={!!id} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl" data-testid="transaction-sheet">
        {isLoading || !tx ? (
          <div className="space-y-4 p-6">
            <Skeleton className="h-8 w-40" />
            <Skeleton className="h-24" />
            <Skeleton className="h-64" />
          </div>
        ) : (
          <>
            <SheetHeader className="gap-3 border-b pb-5">
              <div className="flex items-center gap-2">
                <TransactionStatusBadge status={tx.status} />
                {tx.mode === "test" && <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-medium text-warning-text">Test</span>}
              </div>
              <SheetTitle className="text-3xl font-semibold tracking-tight">{formatMoney(tx.amount, tx.currency)}</SheetTitle>
              <SheetDescription className="flex items-center gap-1 font-mono text-xs">
                {tx.reference}
                <CopyButton value={tx.reference} label="Reference" className="size-6" />
              </SheetDescription>
            </SheetHeader>

            <div className="space-y-6 p-4 pb-8 sm:p-6">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-4 text-sm">
                <Item label="Product">
                  {product ? (
                    <Link href={`/products/${product.id}`}>
                      <ProductChip name={product.name} slot={product.colorSlot} />
                    </Link>
                  ) : (
                    tx.productId
                  )}
                </Item>
                <Item label="Gateway">
                  <span className="flex items-center gap-2">
                    <GatewayMark gatewayId={tx.gatewayId} size="sm" />
                    {gatewayName(tx.gatewayId)}
                  </span>
                </Item>
                <Item label="Customer">
                  <span className="block truncate">{tx.customer.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{tx.customer.email}</span>
                </Item>
                <Item label="Channel">{channelLabel(tx.channel)}</Item>
                <Item label="Created">{formatDateTime(tx.createdAt)}</Item>
                <Item label="Paid">{tx.paidAt ? formatDateTime(tx.paidAt) : "–"}</Item>
                <Item label="Gateway fee">{tx.fee ? formatMoney(tx.fee, tx.currency) : "–"}</Item>
                <Item label="Net">{tx.paidAt ? formatMoney(tx.amount - tx.fee, tx.currency) : "–"}</Item>
              </dl>

              <section>
                <h3 className="mb-3 text-sm font-semibold">Routing</h3>
                <div className="rounded-xl border p-4">
                  <RoutingTimeline steps={tx.timeline} />
                </div>
              </section>

              {tx.deliveries.length > 0 && (
                <section>
                  <h3 className="mb-3 text-sm font-semibold">Deliveries to {product?.name ?? "product"}</h3>
                  <ul className="divide-y rounded-xl border">
                    {tx.deliveries.map((d) => (
                      <li key={d.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                        <DeliveryBadge state={d.state} />
                        <span className="font-mono text-xs">{d.eventType}</span>
                        <span className="ml-auto text-xs text-muted-foreground tabular">
                          {d.attempts}× · {d.statusCode ?? "timeout"}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <Link href="/webhooks?state=failed" className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                    Manage deliveries
                  </Link>
                </section>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1">{children}</dd>
    </div>
  )
}
