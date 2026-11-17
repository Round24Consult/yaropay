"use client"

// YaroPay Enterprise License: see LICENSE.md in the parent folder.

import { formatCount } from "@yaropay/core/money"
import type { PlatformGatewayRow } from "@yaropay/core/platform"
import { Info } from "lucide-react"
import { toast } from "sonner"
import { BetaBadge } from "@/components/shared/beta-badge"
import { GatewayMark } from "@/components/shared/gateway-mark"
import { Panel } from "@/components/shared/page-header"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { usePlatformGateways, useSetGatewayOffered } from "./hooks"
import { isCancelled, PlatformShell, useGuarded } from "./platform-shell"

/** Platform → Gateways: which gateways companies on YaroPay Cloud can add accounts on. */
export function PlatformGatewaysPage() {
  return (
    <PlatformShell title="Gateways" description="Choose which gateways companies can add new accounts on. Every gateway is free in every edition.">
      <Panel className="flex items-start gap-3 p-4 text-sm">
        <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <p className="text-muted-foreground">
          Turning a gateway off only stops <span className="font-medium text-foreground">new</span> accounts. Accounts companies already connected keep taking
          payments, receiving webhooks and forwarding events, and stay visible to them. Companies that never used it stop seeing it on their Apps page.
        </p>
      </Panel>
      <GatewayTable />
    </PlatformShell>
  )
}

function Usage({ counts, noun }: { counts: { live: number; test: number }; noun: string }) {
  if (counts.live + counts.test === 0) return <span className="text-muted-foreground">None</span>
  return (
    <span className="tabular-nums" title={`${noun} with a live / test account`}>
      {formatCount(counts.live)} live · {formatCount(counts.test)} test
    </span>
  )
}

function GatewayTable() {
  const { data } = usePlatformGateways()
  const setOffered = useSetGatewayOffered()
  const guarded = useGuarded()

  const toggle = async (row: PlatformGatewayRow, offered: boolean) => {
    try {
      await guarded(() => setOffered.mutateAsync({ id: row.id, offered }))
      toast.success(offered ? `${row.name} is offered to companies again` : `${row.name} is turned off for new accounts`)
    } catch (err) {
      if (!isCancelled(err)) toast.error(err instanceof Error ? err.message : "Could not change the gateway")
    }
  }

  if (!data) return <Skeleton className="h-72 rounded-2xl" />
  return (
    <Panel className="overflow-hidden">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-5">Gateway</TableHead>
              <TableHead>Companies</TableHead>
              <TableHead>Accounts</TableHead>
              <TableHead className="pr-5 text-right">Offered to Cloud companies</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((row) => (
              <TableRow key={row.id} data-testid={`platform-gateway-${row.id}`}>
                <TableCell className="pl-5">
                  <div className="flex items-center gap-3">
                    <GatewayMark gatewayId={row.id} size="sm" />
                    <span className="font-medium">{row.name}</span>
                    {row.status === "beta" && <BetaBadge />}
                    {row.status === "coming_soon" && <Badge variant="secondary">Coming soon</Badge>}
                  </div>
                </TableCell>
                <TableCell className="text-sm whitespace-nowrap">
                  <Usage counts={row.companies} noun="Companies" />
                </TableCell>
                <TableCell className="text-sm whitespace-nowrap">
                  <Usage counts={row.accounts} noun="Accounts" />
                </TableCell>
                <TableCell className="pr-5 text-right">
                  {row.status === "coming_soon" ? (
                    <span className="text-xs text-muted-foreground">Not built yet</span>
                  ) : (
                    <div className="inline-flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">{row.offered ? "On" : "Off"}</span>
                      <Switch
                        checked={row.offered}
                        disabled={setOffered.isPending}
                        onCheckedChange={(checked) => toggle(row, checked)}
                        aria-label={`Offer ${row.name} to Cloud companies`}
                        data-testid={`gateway-offered-${row.id}`}
                      />
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Panel>
  )
}
