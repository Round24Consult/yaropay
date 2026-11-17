"use client"

import { ArrowUpRight, Check, Plus, Settings2 } from "lucide-react"
import Link from "next/link"
import { GatewayMark } from "@/components/shared/gateway-mark"
import { Panel } from "@/components/shared/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { GatewayListItem } from "@yaropay/core/api"
import { useCan } from "@/lib/auth"
import { CHANNEL_LABELS, formatRelative } from "@/lib/format"
import { cn } from "@/lib/utils"
import { SampleBadge } from "@/components/onboarding/sample-badge"
import { BetaBadge } from "@/components/shared/beta-badge"

export function GatewayCard({ item, onInstall }: { item: GatewayListItem; onInstall: (gatewayId: string) => void }) {
  const { gateway, connections, offered } = item
  const installed = connections.length > 0
  const soon = gateway.status === "coming_soon"
  const canInstall = useCan("gateways:write")
  return (
    <Panel className={cn("flex flex-col p-5", soon && "bg-card/60")} data-testid={`gateway-${gateway.id}`}>
      <div className="flex items-start justify-between gap-3">
        <GatewayMark gatewayId={gateway.id} size="lg" />
        {soon ? (
          <Badge variant="secondary">Coming soon</Badge>
        ) : installed ? (
          <span className="inline-flex h-6 items-center gap-1 rounded-full bg-good/10 px-2 text-xs font-medium text-good-text ring-1 ring-good/25 ring-inset">
            <Check className="size-3.5" /> Installed
          </span>
        ) : (
          <Badge variant="outline">Not installed</Badge>
        )}
      </div>
      <h3 className="mt-4 flex items-center gap-2 font-semibold">
        {gateway.name}
        {gateway.status === "beta" && <BetaBadge />}
      </h3>
      <p className="mt-1 text-sm text-muted-foreground text-pretty">{gateway.tagline}</p>

      {!soon && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {gateway.channels.slice(0, 4).map((c) => (
            <span key={c} className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
              {CHANNEL_LABELS[c]}
            </span>
          ))}
          {gateway.channels.length > 4 && (
            <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">+{gateway.channels.length - 4}</span>
          )}
        </div>
      )}

      {installed && (
        <ul className="mt-4 divide-y rounded-xl border">
          {connections.map((c) => (
            <li key={c.id}>
              <Link href={`/apps/${c.id}`} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted/50">
                <span className={cn("size-1.5 rounded-full", c.mode === "live" ? "bg-good" : "bg-warning")} aria-hidden />
                <span className="font-medium">{c.label}</span>
                <span className="text-xs text-muted-foreground capitalize">{c.mode}</span>
                {c.sample && <SampleBadge />}
                <span className="ml-auto text-xs text-muted-foreground">last event {formatRelative(c.lastEventAt)}</span>
                <Settings2 className="size-3.5 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-auto flex items-center gap-2 pt-5">
        {soon ? (
          <Button variant="outline" size="sm" asChild>
            <a href={gateway.website} target="_blank" rel="noreferrer">
              Learn more <ArrowUpRight />
            </a>
          </Button>
        ) : !offered ? (
          <span className="text-xs text-muted-foreground" data-testid={`gateway-off-${gateway.id}`}>
            Turned off by YaroPay: your accounts keep working, but new ones can&apos;t be added.
          </span>
        ) : !canInstall ? (
          <span className="text-xs text-muted-foreground">{installed ? "Managed by owners and admins" : "Ask an owner or admin to install it"}</span>
        ) : installed ? (
          <Button variant="outline" size="sm" onClick={() => onInstall(gateway.id)}>
            <Plus /> Add another account
          </Button>
        ) : (
          <Button size="sm" onClick={() => onInstall(gateway.id)} data-testid={`install-${gateway.id}`}>
            <Plus /> Install
          </Button>
        )}
        {!soon && (
          <Button variant="ghost" size="sm" asChild className="ml-auto text-muted-foreground">
            <a href={gateway.docsUrl} target="_blank" rel="noreferrer">
              Docs <ArrowUpRight />
            </a>
          </Button>
        )}
      </div>
    </Panel>
  )
}
