"use client"

import { ArrowUpRight, Plus } from "lucide-react"
import Link from "next/link"
import { Delta } from "@/components/shared/delta"
import { GatewayMark } from "@/components/shared/gateway-mark"
import { PageHeader, Panel } from "@/components/shared/page-header"
import { ProductAvatar } from "@/components/shared/product-chip"
import { Sparkline } from "@/components/shared/sparkline"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import type { ProductWithStats } from "@yaropay/core/api"
import { delta, formatMoney, formatPercent } from "@yaropay/core/money"
import { SampleBadge } from "@/components/onboarding/sample-badge"
import { useConnections, useProducts } from "@/lib/api/hooks"
import { useCan, useHasAllProducts } from "@/lib/auth"
import { seriesVar } from "@/lib/colors"
import { KIND_LABELS } from "@/lib/format"
import { cn } from "@/lib/utils"

export function ProductsView() {
  const { data: products, isLoading } = useProducts()
  const { data: connections = [] } = useConnections()
  const canWrite = useCan("products:write")
  const allProducts = useHasAllProducts()
  const canCreate = canWrite && allProducts
  return (
    <div className="space-y-6">
      <PageHeader
        title="Products"
        description="Each website or app that takes payments. Products share your installed gateway accounts, but every payment, callback and webhook stays with the product that started it."
        actions={
          canCreate ? (
            <Button asChild data-testid="new-product">
              <Link href="/products/new">
                <Plus /> New product
              </Link>
            </Button>
          ) : null
        }
      />
      {canCreate && connections.every((c) => c.sample) && !isLoading && (
        <Panel className="flex flex-col gap-3 border-warning/40 bg-warning/5 p-4 sm:flex-row sm:items-center">
          <p className="flex-1 text-sm">
            <span className="font-medium">No payment gateway installed yet.</span>{" "}
            <span className="text-muted-foreground">You can still create a product; the wizard will help you install one.</span>
          </p>
          <Button variant="outline" size="sm" asChild>
            <Link href="/apps">Open apps</Link>
          </Button>
        </Panel>
      )}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {isLoading
          ? Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-64 rounded-2xl" />)
          : products?.map((p) => <ProductCard key={p.id} product={p} gatewayIds={[...new Set(p.gateways.map((g) => connections.find((c) => c.id === g.connectionId)?.gatewayId).filter(Boolean) as string[])]} />)}
        {canCreate && (
        <Link
          href="/products/new"
          className="group grid min-h-64 place-items-center rounded-2xl border border-dashed p-6 text-center transition-colors hover:border-primary/50 hover:bg-accent/30"
        >
          <div>
            <span className="mx-auto grid size-10 place-items-center rounded-full bg-muted transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
              <Plus className="size-5" />
            </span>
            <p className="mt-3 font-medium">Add a product</p>
            <p className="mt-1 text-sm text-muted-foreground">A website, SaaS or mobile app</p>
          </div>
        </Link>
        )}
        {!isLoading && !canCreate && products?.length === 0 && (
          <Panel className="p-8 text-center text-sm text-muted-foreground md:col-span-2 xl:col-span-3">
            {allProducts ? "No products yet. Ask an admin or developer to add one." : "You haven't been given access to any products yet."}
          </Panel>
        )}
      </div>
    </div>
  )
}

function ProductCard({ product: p, gatewayIds }: { product: ProductWithStats; gatewayIds: string[] }) {
  const s = p.stats
  return (
    <Link href={`/products/${p.id}`} className="group block" data-testid={`product-${p.slug}`}>
      <Panel className="relative h-full overflow-hidden p-5 transition-all group-hover:-translate-y-0.5 group-hover:shadow-md">
        <span className="absolute inset-x-0 top-0 h-0.5" style={{ backgroundColor: seriesVar(p.colorSlot) }} aria-hidden />
        <div className="flex items-start gap-3">
          <ProductAvatar name={p.name} slot={p.colorSlot} />
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 font-semibold">
              {p.name}
              {p.status === "paused" && <Badge variant="secondary">Paused</Badge>}
              {p.sample && <SampleBadge />}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {KIND_LABELS[p.kind]} · {p.websiteUrl.replace(/^https?:\/\//, "")}
            </p>
          </div>
          <ArrowUpRight className="size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
        </div>
        <div className="mt-5 flex items-end justify-between gap-4">
          <div>
            <p className="text-xs text-muted-foreground">Last 30 days</p>
            <p className="mt-1 text-xl font-semibold tracking-tight">{formatMoney(s.volume30d, s.currency, { compact: s.volume30d >= 1e10 })}</p>
            <Delta value={delta(s.volume30d, s.previousVolume30d)} />
          </div>
          <Sparkline values={s.spark} color={seriesVar(p.colorSlot)} className="w-28" height={40} />
        </div>
        <dl className="mt-5 grid grid-cols-3 gap-2 border-t pt-4 text-xs">
          <div>
            <dt className="text-muted-foreground">Success</dt>
            <dd className="mt-0.5 font-medium tabular">{formatPercent(s.successRate30d)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Webhooks</dt>
            <dd className={cn("mt-0.5 font-medium tabular", s.deliveryHealth < 0.95 && "text-warning-text")}>{formatPercent(s.deliveryHealth)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Prefix</dt>
            <dd className="mt-0.5 font-mono font-medium">{p.referencePrefix}_</dd>
          </div>
        </dl>
        <div className="mt-4 flex items-center gap-1.5">
          {gatewayIds.map((g) => (
            <GatewayMark key={g} gatewayId={g} size="sm" />
          ))}
          <span className="ml-1 text-xs text-muted-foreground">
            {gatewayIds.length} gateway{gatewayIds.length === 1 ? "" : "s"}
          </span>
        </div>
      </Panel>
    </Link>
  )
}
