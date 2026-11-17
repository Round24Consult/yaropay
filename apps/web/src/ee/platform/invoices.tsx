"use client"

// YaroPay Enterprise License: see LICENSE.md in the parent folder.

import { type Invoice, periodLabel } from "@yaropay/core/billing"
import { formatCount, formatMoney } from "@yaropay/core/money"
import { PLATFORM_INVOICE_FILTERS, type PlatformInvoiceFilter } from "@yaropay/core/platform"
import Link from "next/link"
import * as React from "react"
import { Panel } from "@/components/shared/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatDate } from "@/lib/format"
import { cn } from "@/lib/utils"
import { usePlatformInvoices } from "./hooks"
import { PlatformShell } from "./platform-shell"
import { InvoiceAction } from "./workspace-detail"

const FILTER_LABELS: Record<PlatformInvoiceFilter, string> = { all: "All", open: "Open", overdue: "Overdue", paid: "Paid", void: "Void" }

/** Platform → Invoices: every company's invoices in one list. */
export function InvoicesPage() {
  return (
    <PlatformShell title="Invoices" description="Every company's invoices, newest first. Invoices are written on the 1st for the month before and are due 7 days later.">
      <InvoiceList />
    </PlatformShell>
  )
}

function InvoiceList() {
  const [status, setStatus] = React.useState<PlatformInvoiceFilter>("all")
  const [page, setPage] = React.useState(1)
  const { data, isLoading } = usePlatformInvoices({ status, page })
  const [acting, setActing] = React.useState<{ invoice: Invoice; kind: "paid" | "void" } | null>(null)
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1

  return (
    <div className="space-y-4">
      <div className="flex gap-1 overflow-x-auto rounded-xl border bg-card p-1" role="tablist" aria-label="Invoice status">
        {PLATFORM_INVOICE_FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            role="tab"
            aria-selected={status === f}
            data-testid={`invoices-filter-${f}`}
            onClick={() => {
              setStatus(f)
              setPage(1)
            }}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
              status === f ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {FILTER_LABELS[f]}
            {data && <span className={cn("text-xs tabular-nums", f === "overdue" && data.counts.overdue > 0 && "text-critical-text")}>{formatCount(data.counts[f])}</span>}
          </button>
        ))}
      </div>

      <Panel className="overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">Company</TableHead>
                <TableHead>Invoice</TableHead>
                <TableHead>Month</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Due</TableHead>
                <TableHead className="pr-5 text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading &&
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={7} className="px-5">
                      <Skeleton className="h-5" />
                    </TableCell>
                  </TableRow>
                ))}
              {data?.invoices.map((i) => {
                const overdue = i.status === "open" && new Date(i.dueAt) < new Date()
                return (
                  <TableRow key={i.id} data-testid={`platform-invoice-${i.number}`}>
                    <TableCell className="pl-5 text-sm">
                      <Link href={`/platform/workspaces/${i.workspaceId}`} className="font-medium hover:underline">
                        {i.workspaceName}
                      </Link>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{i.number}</TableCell>
                    <TableCell className="text-sm whitespace-nowrap">{periodLabel(i.period)}</TableCell>
                    <TableCell className="text-right text-sm tabular-nums">{formatMoney(i.total, i.currency)}</TableCell>
                    <TableCell className="text-sm">
                      {i.status === "open" ? overdue ? <Badge variant="destructive">Overdue</Badge> : <Badge>Open</Badge> : i.status === "paid" ? "Paid" : "Void"}
                      {i.status === "paid" && i.paidVia && <span className="ml-1 text-xs text-muted-foreground">({i.paidVia === "card" ? "card" : "by hand"})</span>}
                      {i.note && <p className="text-xs text-muted-foreground">{i.note}</p>}
                      {i.status === "open" && i.lastError && <p className="text-xs text-critical-text">Card charge failed: {i.lastError}</p>}
                    </TableCell>
                    <TableCell className="text-sm whitespace-nowrap text-muted-foreground">{formatDate(i.dueAt)}</TableCell>
                    <TableCell className="pr-5 text-right whitespace-nowrap">
                      {i.status === "open" && (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => setActing({ invoice: i, kind: "paid" })}>
                            Mark paid
                          </Button>
                          <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setActing({ invoice: i, kind: "void" })}>
                            Void
                          </Button>
                        </>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
              {data && data.invoices.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                    {status === "all" ? "No invoices yet. The first ones are written on the 1st of next month." : `No ${FILTER_LABELS[status].toLowerCase()} invoices.`}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        {data && pages > 1 && (
          <div className="flex items-center justify-between gap-2 border-t px-5 py-3 text-sm text-muted-foreground">
            <span>
              Page {page} of {pages} · {formatCount(data.total)} invoices
            </span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </div>
          </div>
        )}
      </Panel>

      <Dialog open={acting !== null} onOpenChange={(o) => !o && setActing(null)}>
        <DialogContent>{acting && <InvoiceAction {...acting} onDone={() => setActing(null)} />}</DialogContent>
      </Dialog>
    </div>
  )
}
