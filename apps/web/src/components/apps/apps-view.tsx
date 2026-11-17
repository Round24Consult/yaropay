"use client"

import { Blocks } from "lucide-react"
import * as React from "react"
import { PageHeader, Panel } from "@/components/shared/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import { useGateways } from "@/lib/api/hooks"
import { isInstallable } from "@yaropay/core/gateways/types"
import { GatewayCard } from "./gateway-card"
import { InstallDialog } from "./install-dialog"

export function AppsView() {
  const { data, isLoading } = useGateways()
  const [installing, setInstalling] = React.useState<string | null>(null)
  const available = data?.filter((i) => isInstallable(i.gateway)) ?? []
  const soon = data?.filter((i) => i.gateway.status === "coming_soon") ?? []
  const installedCount = available.filter((i) => i.connections.length).length

  return (
    <div className="space-y-8">
      <PageHeader
        title="Apps"
        description="Installing a payment gateway means adding its keys once. Every product can then use it, and YaroPay keeps each product's payments, callbacks and webhooks separate."
      />
      <Panel className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
        <span className="grid size-9 place-items-center rounded-lg bg-accent text-accent-foreground">
          <Blocks className="size-4" />
        </span>
        <div className="text-sm">
          <p className="font-medium">
            {installedCount} of {available.length} gateways installed
          </p>
          <p className="text-muted-foreground">
            A gateway account sends all of its events to one YaroPay webhook URL. YaroPay matches each event to the product that started the payment.
          </p>
        </div>
      </Panel>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Payment gateways</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {isLoading
            ? Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-72 rounded-2xl" />)
            : available.map((item) => <GatewayCard key={item.gateway.id} item={item} onInstall={setInstalling} />)}
        </div>
      </section>

      {soon.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold">Coming soon</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {soon.map((item) => (
              <GatewayCard key={item.gateway.id} item={item} onInstall={setInstalling} />
            ))}
          </div>
        </section>
      )}

      <InstallDialog gatewayId={installing} open={!!installing} onOpenChange={(o) => !o && setInstalling(null)} />
    </div>
  )
}
