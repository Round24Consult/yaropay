"use client"

import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Loader2, RotateCw, ShieldAlert } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"
import { GatewayMark, gatewayName } from "@/components/shared/gateway-mark"
import { Panel } from "@/components/shared/page-header"
import { ProductChip } from "@/components/shared/product-chip"
import { DeliveryBadge, Pill } from "@/components/shared/status-badge"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { EventRow } from "@yaropay/core/api"
import type { WebhookDelivery } from "@yaropay/core/types"
import { useDeliveries, useEvents, useProducts, useReplayDelivery } from "@/lib/api/hooks"
import { useCan } from "@/lib/auth"
import { formatDateTime, formatRelative } from "@/lib/format"
import { useMode } from "@/lib/mode"
import { cn } from "@/lib/utils"

export function Pager({ page, pages, total, onPage }: { page: number; pages: number; total: number; onPage: (p: number) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 border-t px-4 py-3 text-xs text-muted-foreground">
      <span className="tabular">{total.toLocaleString()} results</span>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon-sm" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
          <ChevronLeft />
        </Button>
        <span className="tabular">
          {page} / {pages}
        </span>
        <Button variant="ghost" size="icon-sm" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">
          <ChevronRight />
        </Button>
      </div>
    </div>
  )
}

export function JsonView({ value }: { value: unknown }) {
  return (
    <pre className="max-h-80 overflow-auto rounded-xl border bg-zinc-950 p-4 font-mono text-[12px] leading-relaxed text-zinc-100 dark:bg-black/40">
      {JSON.stringify(value, (_k, v) => (v === undefined ? undefined : v), 2)}
    </pre>
  )
}

const STATES = [
  { value: "", label: "All" },
  { value: "failed", label: "Failed" },
  { value: "retrying", label: "Retrying" },
  { value: "delivered", label: "Delivered" },
  { value: "pending", label: "Queued" },
]

/** Outgoing deliveries: what YaroPay forwarded to each product, with replay. */
export function DeliveriesTable({ productId, state, onState }: { productId?: string; state: string; onState: (s: string) => void }) {
  const { mode } = useMode()
  const [page, setPage] = React.useState(1)
  const { data: products = [] } = useProducts()
  const { data, isLoading } = useDeliveries({ mode, product: productId ? [productId] : undefined, state: state ? [state] : undefined, page, pageSize: 15 })
  const replay = useReplayDelivery()
  const canReplay = useCan("webhooks:replay")
  const [open, setOpen] = React.useState<WebhookDelivery | null>(null)

  const doReplay = async (d: WebhookDelivery) => {
    try {
      const res = await replay.mutateAsync(d.id)
      const name = products.find((p) => p.id === d.productId)?.name ?? "the product"
      if (res.state === "delivered") toast.success(`Delivered to ${name}: ${res.statusCode} in ${res.latencyMs} ms`)
      else if (res.statusCode) toast.warning(`${name} answered ${res.statusCode}. YaroPay will retry automatically.`)
      else toast.warning(`${name} did not respond. YaroPay will retry automatically.`)
      setOpen((o) => (o?.id === res.id ? res : o))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Replay failed to start")
    }
  }

  return (
    <Panel className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
        <div role="radiogroup" aria-label="Delivery state" className="flex h-8 items-center rounded-lg border bg-background p-0.5">
          {STATES.map((s) => (
            <button
              key={s.value}
              type="button"
              role="radio"
              aria-checked={state === s.value}
              onClick={() => {
                onState(s.value)
                setPage(1)
              }}
              className={cn(
                "flex h-full items-center gap-1.5 rounded-md px-2.5 text-xs font-medium",
                state === s.value ? "bg-secondary text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {s.label}
              {s.value && data?.counts[s.value] ? <span className="text-muted-foreground tabular">{data.counts[s.value]}</span> : null}
            </button>
          ))}
        </div>
        <p className="ml-auto text-xs text-muted-foreground">Failed deliveries retry with backoff for 24 hours.</p>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Status</TableHead>
              {!productId && <TableHead>Product</TableHead>}
              <TableHead>Event</TableHead>
              <TableHead className="hidden md:table-cell">Endpoint</TableHead>
              <TableHead className="text-right">Attempts</TableHead>
              <TableHead className="hidden text-right sm:table-cell">Latency</TableHead>
              <TableHead>Time</TableHead>
              <TableHead className="pr-4 text-right">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading &&
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={8}>
                    <Skeleton className="h-6" />
                  </TableCell>
                </TableRow>
              ))}
            {data?.rows.map((d) => {
              const p = products.find((x) => x.id === d.productId)
              const pending = replay.isPending && replay.variables === d.id
              return (
                <TableRow key={d.id} className="cursor-pointer" onClick={() => setOpen(d)} data-testid={`delivery-${d.id}`}>
                  <TableCell className="pl-4">
                    <DeliveryBadge state={d.state} />
                  </TableCell>
                  {!productId && <TableCell>{p && <ProductChip name={p.name} slot={p.colorSlot} size="sm" />}</TableCell>}
                  <TableCell className="font-mono text-xs">{d.eventType}</TableCell>
                  <TableCell className="hidden max-w-56 truncate font-mono text-xs text-muted-foreground md:table-cell">{d.url}</TableCell>
                  <TableCell className="text-right tabular">
                    {d.attempts}
                    {d.statusCode ? <span className="ml-1.5 text-xs text-muted-foreground">({d.statusCode})</span> : null}
                  </TableCell>
                  <TableCell className="hidden text-right tabular sm:table-cell">{d.latencyMs ? `${d.latencyMs} ms` : "–"}</TableCell>
                  <TableCell className="text-xs whitespace-nowrap text-muted-foreground">{formatDateTime(d.createdAt)}</TableCell>
                  <TableCell className="pr-4 text-right">
                    {canReplay && d.state !== "delivered" && (
                      <Button
                        variant="outline"
                        size="xs"
                        disabled={pending}
                        onClick={(e) => {
                          e.stopPropagation()
                          doReplay(d)
                        }}
                        data-testid={`replay-${d.id}`}
                      >
                        {pending ? <Loader2 className="animate-spin" /> : <RotateCw />}
                        Replay
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
            {data && data.rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-12 text-center text-sm text-muted-foreground">
                  <CheckCircle2 className="mx-auto mb-2 size-5 text-good-text" />
                  Nothing here. Every delivery in this view went through.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {data && <Pager page={data.page} pages={data.pages} total={data.total} onPage={setPage} />}

      <Sheet open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          {open && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  Delivery <code className="font-mono text-sm text-muted-foreground">{open.id}</code>
                </SheetTitle>
                <SheetDescription>{open.url}</SheetDescription>
              </SheetHeader>
              <div className="space-y-5 px-4 pb-6">
                <div className="flex flex-wrap items-center gap-2">
                  <DeliveryBadge state={open.state} />
                  <span className="text-xs text-muted-foreground">
                    {open.lastAttemptAt
                      ? `${open.attempts} attempt${open.attempts === 1 ? "" : "s"} · last ${formatRelative(open.lastAttemptAt)}`
                      : "Not attempted yet"}
                  </span>
                  {open.nextRetryAt && <span className="text-xs text-muted-foreground">· next retry {formatDateTime(open.nextRetryAt)}</span>}
                </div>
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <Info label="Event" value={<code className="font-mono text-xs">{open.eventType}</code>} />
                  <Info label="HTTP status" value={open.statusCode ?? "timeout"} />
                  <Info label="Latency" value={open.latencyMs ? `${open.latencyMs} ms` : "–"} />
                  <Info label="Signature header" value={<code className="font-mono text-xs">x-yaropay-signature</code>} />
                </dl>
                <div>
                  <p className="mb-1.5 text-xs font-medium text-muted-foreground">Response body</p>
                  <JsonView value={open.responseSnippet} />
                </div>
                {canReplay && open.state !== "delivered" && (
                  <Button onClick={() => doReplay(open)} disabled={replay.isPending} className="w-full">
                    {replay.isPending ? <Loader2 className="animate-spin" /> : <RotateCw />}
                    Replay now
                  </Button>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </Panel>
  )
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-medium">{value}</dd>
    </div>
  )
}

/** Incoming events from gateways, with the product each one was matched to. */
export function EventsTable({ routing, onRouting }: { routing: string; onRouting: (r: string) => void }) {
  const { mode } = useMode()
  const [page, setPage] = React.useState(1)
  const { data: products = [] } = useProducts()
  const { data, isLoading } = useEvents({ mode, routing: routing || undefined, page, pageSize: 15 })
  const [open, setOpen] = React.useState<EventRow | null>(null)
  const options = [
    { value: "", label: "All events" },
    { value: "routed", label: "Routed" },
    { value: "unrouted", label: "Unrouted" },
  ]
  return (
    <Panel className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
        <div role="radiogroup" aria-label="Routing" className="flex h-8 items-center rounded-lg border bg-background p-0.5">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={routing === o.value}
              onClick={() => {
                onRouting(o.value)
                setPage(1)
              }}
              className={cn(
                "h-full rounded-md px-2.5 text-xs font-medium",
                routing === o.value ? "bg-secondary text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
        <p className="ml-auto text-xs text-muted-foreground">Events arrive at one URL per gateway account and are matched by reference prefix and metadata.</p>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Gateway</TableHead>
              <TableHead>Event</TableHead>
              <TableHead>Reference</TableHead>
              <TableHead>Signature</TableHead>
              <TableHead>Routed to</TableHead>
              <TableHead className="pr-4">Received</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading &&
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={6}>
                    <Skeleton className="h-6" />
                  </TableCell>
                </TableRow>
              ))}
            {data?.rows.map((e) => {
              const p = products.find((x) => x.id === e.productId)
              return (
                <TableRow key={e.id} className="cursor-pointer" onClick={() => setOpen(e)}>
                  <TableCell className="pl-4">
                    <span className="flex items-center gap-2">
                      <GatewayMark gatewayId={e.gatewayId} size="sm" />
                      <span className="text-sm">{gatewayName(e.gatewayId)}</span>
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{e.type}</TableCell>
                  <TableCell className="font-mono text-xs">{e.reference ?? "–"}</TableCell>
                  <TableCell>
                    {e.signatureValid ? (
                      <Pill tone="good" icon={CheckCircle2}>
                        Valid
                      </Pill>
                    ) : (
                      <Pill tone="critical" icon={ShieldAlert}>
                        Rejected
                      </Pill>
                    )}
                  </TableCell>
                  <TableCell>
                    {p ? (
                      <ProductChip name={p.name} slot={p.colorSlot} size="sm" />
                    ) : (
                      <Pill tone="warning" icon={AlertTriangle}>
                        Unrouted
                      </Pill>
                    )}
                  </TableCell>
                  <TableCell className="pr-4 text-xs whitespace-nowrap text-muted-foreground">{formatDateTime(e.receivedAt)}</TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
      {data && <Pager page={data.page} pages={data.pages} total={data.total} onPage={setPage} />}

      <Sheet open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          {open && (
            <>
              <SheetHeader>
                <SheetTitle className="font-mono text-base">{open.type}</SheetTitle>
                <SheetDescription>
                  {gatewayName(open.gatewayId)} · received {formatDateTime(open.receivedAt)}
                </SheetDescription>
              </SheetHeader>
              <div className="space-y-4 px-4 pb-6">
                {open.productId ? (
                  <div className="rounded-xl border p-3 text-sm">
                    Matched to <strong>{products.find((x) => x.id === open.productId)?.name}</strong> by reference prefix and metadata, then forwarded
                    {open.delivery ? (
                      <span className="ml-1 inline-flex align-middle">
                        <DeliveryBadge state={open.delivery.state} />
                      </span>
                    ) : null}
                    .
                  </div>
                ) : (
                  <div className="flex gap-2 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning-text" />
                    <p>
                      <span className="font-medium">No product owns this reference.</span>{" "}
                      <span className="text-muted-foreground">
                        It was probably paid outside YaroPay (for example a {gatewayName(open.gatewayId)} payment page). It is stored but not forwarded.
                      </span>
                    </p>
                  </div>
                )}
                {!open.signatureValid && (
                  <p className="text-sm text-critical-text">The signature did not match, so this event was rejected and not processed.</p>
                )}
                <div>
                  <p className="mb-1.5 text-xs font-medium text-muted-foreground">Payload</p>
                  <JsonView value={open.payload} />
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </Panel>
  )
}
