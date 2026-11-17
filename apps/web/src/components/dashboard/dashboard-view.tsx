"use client"

import { FlaskConical } from "lucide-react"
import { SetupChecklist, useCanSetUp } from "@/components/onboarding/setup-checklist"
import { useLoadSample } from "@/components/onboarding/sample-data"
import { PageHeader, Panel } from "@/components/shared/page-header"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { defaultGranularity, type Granularity, resolvePeriod } from "@yaropay/core/analytics"
import { useOnboarding, useOverview, useProducts, useSettings } from "@/lib/api/hooks"
import { useCan, useHasAllProducts, useMe } from "@/lib/auth"
import { cn } from "@/lib/utils"
import { ChannelMix, GatewaySplit, Outcomes, ProductBreakdown, WebhookHealth } from "./breakdowns"
import { ActiveFilterChips, CurrencySelect, GatewaySelect, PeriodControl, ProductMultiSelect } from "./filter-bar"
import { KpiCards } from "./kpi-cards"
import { RecentPayments } from "./recent-payments"
import { RevenueChart } from "./revenue-chart"
import { useDashboardFilters } from "./use-dashboard-filters"
import { useWidgetLayout } from "./use-widget-layout"
import { WidgetCustomizer } from "./widget-customizer"
import { WIDGETS, type WidgetId } from "./widgets"

function greeting() {
  const h = new Date().getHours()
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"
}

export function DashboardView({ scopeProductId }: { scopeProductId?: string }) {
  const me = useMe()
  const { filters, setFilters, params, scoped } = useDashboardFilters({ product: scopeProductId })
  const { data: products = [], isSuccess: productsLoaded } = useProducts()
  const { data: settings } = useSettings()
  const { data: onboarding } = useOnboarding({ enabled: !scopeProductId })
  const canSetUp = useCanSetUp()
  const { data } = useOverview(params, { live: true })
  const { layout, toggle, reorder, reset } = useWidgetLayout()

  const range = resolvePeriod(filters.period, new Date(), { from: filters.from ?? undefined, to: filters.to ?? undefined })
  const granularity: Granularity = (data?.query.granularity ?? filters.granularity ?? defaultGranularity(range.from, range.to)) as Granularity
  const currency = filters.currency
  const productMeta = products.map(({ id, name, colorSlot }) => ({ id, name, colorSlot }))
  const scope = scoped ? [scopeProductId!] : filters.product

  const toggleProduct = (id: string) =>
    setFilters({ product: filters.product.includes(id) ? filters.product.filter((p) => p !== id) : [...filters.product, id] })

  if (productsLoaded && products.length === 0 && !scoped) {
    return <EmptyInstall />
  }

  const render = (id: WidgetId) => {
    switch (id) {
      case "kpis":
        return <KpiCards data={data} currency={currency} />
      case "revenue":
        return (
          <RevenueChart
            data={data}
            products={productMeta}
            currency={currency}
            granularity={granularity}
            onGranularity={(g) => setFilters({ granularity: g })}
          />
        )
      case "gateways":
        return <GatewaySplit data={data} currency={currency} products={productMeta} />
      case "products":
        return scoped ? null : (
          <ProductBreakdown data={data} products={productMeta} currency={currency} selected={filters.product} onSelect={toggleProduct} />
        )
      case "channels":
        return <ChannelMix data={data} currency={currency} />
      case "outcomes":
        return <Outcomes data={data} />
      case "webhooks":
        return <WebhookHealth data={data} />
      case "recent":
        return <RecentPayments products={productMeta} scope={scope} />
    }
  }

  const visible = layout.order.filter((id) => !layout.hidden.includes(id) && !(scoped && id === "products"))

  const filterControls = (
    <div className="flex flex-wrap items-center gap-2">
      {!scoped && (
        <ProductMultiSelect
          options={productMeta}
          value={filters.product}
          onChange={(v) => setFilters({ product: v })}
          className="min-w-40"
        />
      )}
      <PeriodControl
        period={filters.period}
        from={filters.from}
        to={filters.to}
        onChange={(v) => setFilters({ period: v.period as typeof filters.period, from: v.from ?? null, to: v.to ?? null, granularity: null })}
      />
      <GatewaySelect value={filters.gateway} onChange={(v) => setFilters({ gateway: v })} />
      <CurrencySelect value={currency} onChange={(v) => setFilters({ currency: v })} />
      {!scoped && <WidgetCustomizer layout={layout} onToggle={toggle} onReorder={reorder} onReset={reset} />}
    </div>
  )

  return (
    <div className="space-y-6">
      {scoped ? (
        filterControls
      ) : (
        <PageHeader
          title={`${greeting()}, ${me.name.split(" ")[0]}`}
          description={`Payments across ${products.length} product${products.length === 1 ? "" : "s"} at ${settings?.companyName ?? "your company"}, shown in ${currency}. Pick a product to focus.`}
        >
          {filterControls}
          <ActiveFilterChips
            products={productMeta}
            selected={filters.product}
            onRemove={(id) => setFilters({ product: filters.product.filter((p) => p !== id) })}
            onClear={() => setFilters({ product: [] })}
          />
        </PageHeader>
      )}

      {!scoped && canSetUp && onboarding && !onboarding.dismissed && onboarding.completed < onboarding.total && <SetupChecklist status={onboarding} />}

      <div className="grid grid-flow-row-dense gap-4 lg:grid-cols-12">
        {visible.map((id) => {
          const el = render(id)
          if (!el) return null
          const w = WIDGETS.find((x) => x.id === id)!
          return (
            <div key={id} className={cn("min-w-0", w.span)}>
              {el}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** First visit to an install with no products: the full setup guide, plus sample data for a quick look. */
function EmptyInstall() {
  const me = useMe()
  const canSetUp = useCanSetUp()
  const canSample = useCan("settings:write")
  const allProducts = useHasAllProducts()
  const { data: status } = useOnboarding()
  const { data: settings } = useSettings()
  const sample = useLoadSample()
  const first = me.name.split(" ")[0]

  if (!canSetUp) {
    return (
      <div className="mx-auto max-w-2xl space-y-6 py-8">
        <PageHeader
          title={`Welcome, ${first}`}
          description={
            allProducts
              ? "No products have been set up yet. Once an owner, admin or developer adds one, its payments show up here."
              : "You haven't been given access to any products yet. Ask an owner or admin to add you to one."
          }
        />
      </div>
    )
  }
  return (
    <div className="mx-auto max-w-5xl space-y-6 py-2">
      <PageHeader
        title={`Welcome, ${first}`}
        description={`Let's get ${settings?.companyName ?? "your company"} taking payments. Each step ticks itself off as soon as YaroPay sees it happen, so you can come and go.`}
      />
      {status ? <SetupChecklist status={status} variant="full" /> : <Skeleton className="h-96 rounded-2xl" />}
      {status?.sampleData.canLoad && canSample && (
        <Panel className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted">
            <FlaskConical className="size-5" aria-hidden />
          </span>
          <div className="flex-1">
            <p className="font-medium">Just looking around?</p>
            <p className="text-sm text-muted-foreground">
              Load a made-up company with three products and a year of payments. Nothing is sent to a gateway, and it&apos;s removed in one click.
            </p>
          </div>
          <Button variant="outline" disabled={sample.pending} onClick={() => sample.run()} data-testid="empty-load-sample">
            {sample.pending ? <Spinner /> : <FlaskConical />} Load sample data
          </Button>
        </Panel>
      )}
    </div>
  )
}
