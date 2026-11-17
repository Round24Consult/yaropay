"use client"

// YaroPay Enterprise License: see LICENSE.md in the parent folder.

import { formatCount, formatMoney } from "@yaropay/core/money"
import type { PlatformOverview } from "@yaropay/core/platform"
import { AlertTriangle, Loader2, Plus, Search } from "lucide-react"
import { toast } from "sonner"
import Link from "next/link"
import { useRouter } from "next/navigation"
import * as React from "react"
import { Panel } from "@/components/shared/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { CopyField } from "@/components/shared/copy-field"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatDate, formatRelative } from "@/lib/format"
import { useCreateWorkspace, usePlans, usePlatformOverview, usePlatformWorkspaces, useRunInvoicing } from "./hooks"
import { isCancelled, PlatformShell, useGuarded } from "./platform-shell"

export function CompaniesPage() {
  return (
    <PlatformShell title="Platform" description="Every company on YaroPay Cloud: what they use this month and what it will bill." actions={
        <>
          <RunInvoicing />
          <NewCompany />
        </>
      }>
      <Totals />
      <CompanyList />
    </PlatformShell>
  )
}

function Tile({ label, value, hint, testId }: { label: string; value: React.ReactNode; hint?: React.ReactNode; testId?: string }) {
  return (
    <Panel className="flex flex-col gap-2 p-5" data-testid={testId}>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-[1.5rem] leading-none font-semibold tracking-tight">{value}</p>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </Panel>
  )
}

function Totals() {
  const { data } = usePlatformOverview()
  if (!data) return <Skeleton className="h-28 rounded-2xl" />
  return (
    <div className="space-y-4">
      {data.missingRates.length > 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm" role="alert">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning-text" aria-hidden />
          <p>
            Live volume in {data.missingRates.join(", ")} has no exchange rate, so it isn&apos;t counted in volume fees.{" "}
            <Link href="/platform/pricing" className="font-medium underline underline-offset-2">
              Add rates
            </Link>
          </p>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Tile
          label="Companies"
          value={formatCount(data.workspaces.total)}
          hint={`${data.workspaces.trialing} in trial · ${data.workspaces.suspended} suspended · ${data.workspaces.newLast30Days} new in 30 days`}
          testId="platform-companies"
        />
        <Tile label="Live products this month" value={formatCount(data.liveProducts)} hint="Trials and free months included" testId="platform-live-products" />
        <Tile label="Billed so far this month" value={<Revenue data={data} />} hint="After trials and free months" testId="platform-revenue" />
        <Tile
          label="Problems in the last 24 hours"
          value={formatCount(data.failedDeliveries24h + data.unroutedEvents24h)}
          hint={`${data.failedDeliveries24h} failed deliveries · ${data.unroutedEvents24h} unrouted events`}
        />
      </div>
      {data.volume.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Live volume this month: {data.volume.map((v) => `${formatMoney(v.amount, v.currency, { compact: true })} (${formatCount(v.count)} payments)`).join(" · ")}
        </p>
      )}
    </div>
  )
}

function Revenue({ data }: { data: PlatformOverview }) {
  const parts = (["NGN", "USD"] as const).filter((c) => data.estimatedRevenue[c] > 0).map((c) => formatMoney(data.estimatedRevenue[c], c, { compact: data.estimatedRevenue[c] >= 1e10 }))
  return <>{parts.length ? parts.join(" + ") : formatMoney(0, "NGN")}</>
}

function CompanyList() {
  const router = useRouter()
  const [q, setQ] = React.useState("")
  const [search, setSearch] = React.useState("")
  const [status, setStatus] = React.useState<string>("all")
  const [page, setPage] = React.useState(1)
  const { data, isLoading } = usePlatformWorkspaces({ q: search || undefined, status: status === "all" ? undefined : status, page })

  React.useEffect(() => {
    const id = setTimeout(() => {
      setSearch(q.trim())
      setPage(1)
    }, 250)
    return () => clearTimeout(id)
  }, [q])

  const pages = data ? Math.max(1, Math.ceil(data.total / 50)) : 1
  return (
    <Panel className="overflow-hidden">
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by company or member email" className="pl-9" aria-label="Search companies" />
        </div>
        <Select
          value={status}
          onValueChange={(v) => {
            setStatus(v)
            setPage(1)
          }}
        >
          <SelectTrigger className="sm:w-40" aria-label="Status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All companies</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="trialing">In trial</SelectItem>
            <SelectItem value="suspended">Suspended</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-5">Company</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead className="text-right">Live products</TableHead>
              <TableHead className="text-right">This month</TableHead>
              <TableHead className="hidden md:table-cell">Joined</TableHead>
              <TableHead className="hidden pr-5 lg:table-cell">Last active</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading &&
              Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={6} className="px-5">
                    <Skeleton className="h-6" />
                  </TableCell>
                </TableRow>
              ))}
            {data?.rows.map((w) => (
              <TableRow key={w.id} className="cursor-pointer" onClick={() => router.push(`/platform/workspaces/${w.id}`)} data-testid={`company-${w.slug}`}>
                <TableCell className="pl-5">
                  <Link href={`/platform/workspaces/${w.id}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
                    {w.name}
                  </Link>
                  <p className="text-xs text-muted-foreground">{w.ownerEmail ?? "No owner"} · {w.members} member{w.members === 1 ? "" : "s"}</p>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm">{w.planName ?? w.plan}</span>
                    {w.status === "suspended" && <Badge variant="destructive">Suspended</Badge>}
                    {w.billingStatus === "past_due" && <Badge variant="destructive">Overdue</Badge>}
                    {w.trialEndsAt && new Date(w.trialEndsAt) > new Date() && <Badge variant="secondary">Trial to {formatDate(w.trialEndsAt)}</Badge>}
                    {w.pendingTrialDays !== null && <Badge variant="outline">Test mode only</Badge>}
                    {w.freeUntil && new Date(w.freeUntil) > new Date() && <Badge variant="secondary">Free to {formatDate(w.freeUntil)}</Badge>}
                  </div>
                </TableCell>
                <TableCell className="text-right tabular-nums">{w.liveProducts}</TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(w.estimate, w.billingCurrency)}</TableCell>
                <TableCell className="hidden text-sm text-muted-foreground md:table-cell">{formatDate(w.createdAt)}</TableCell>
                <TableCell className="hidden pr-5 text-sm text-muted-foreground lg:table-cell">{w.lastActiveAt ? formatRelative(w.lastActiveAt) : "Never"}</TableCell>
              </TableRow>
            ))}
            {data && data.rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                  No companies match.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {pages > 1 && (
        <div className="flex items-center justify-between border-t px-5 py-3 text-sm text-muted-foreground">
          <span>
            Page {page} of {pages} · {data?.total} companies
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
  )
}

/** Invoices are written hourly once a month ends; this writes any that are due right now. */
function RunInvoicing() {
  const guarded = useGuarded()
  const run = useRunInvoicing()
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={run.isPending}
      onClick={async () => {
        try {
          const { written } = await guarded(() => run.mutateAsync())
          toast.success(written ? `Wrote ${written} invoice${written === 1 ? "" : "s"} for last month` : "Last month's invoices are all written")
        } catch (e) {
          if (!isCancelled(e)) toast.error(e instanceof Error ? e.message : "Could not write invoices")
        }
      }}
    >
      {run.isPending && <Loader2 className="animate-spin" />}
      Write last month&apos;s invoices
    </Button>
  )
}

/** A company for a customer, before sign-ups open or as a custom deal. Its owner gets an invite. */
function NewCompany() {
  const router = useRouter()
  const guarded = useGuarded()
  const create = useCreateWorkspace()
  const { data: plans } = usePlans()
  const [open, setOpen] = React.useState(false)
  const [name, setName] = React.useState("")
  const [ownerEmail, setOwnerEmail] = React.useState("")
  const [plan, setPlan] = React.useState<string>("")
  const [currency, setCurrency] = React.useState<"NGN" | "USD">("NGN")
  const [shared, setShared] = React.useState<{ id: string; url: string } | null>(null)
  const active = (plans ?? []).filter((p) => p.active)

  const reset = () => {
    setName("")
    setOwnerEmail("")
    setPlan("")
    setCurrency("NGN")
    setShared(null)
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)} data-testid="new-company">
        <Plus /> New company
      </Button>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o)
          if (!o) reset()
        }}
      >
        <DialogContent>
          {shared ? (
            <div className="space-y-4">
              <DialogHeader>
                <DialogTitle>Company created</DialogTitle>
                <DialogDescription>Email isn&apos;t set up on this install, so share this invite link with the owner yourself. It works for 7 days.</DialogDescription>
              </DialogHeader>
              <CopyField label="Owner's invite link" value={shared.url} />
              <DialogFooter>
                <Button
                  onClick={() => {
                    // Close first: Next keeps this page's state when coming back to it.
                    const id = shared.id
                    setOpen(false)
                    reset()
                    router.push(`/platform/workspaces/${id}`)
                  }}
                >
                  Open the company
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <form
              className="space-y-4"
              onSubmit={async (e) => {
                e.preventDefault()
                try {
                  const res = await guarded(() => create.mutateAsync({ name, ownerEmail, billingCurrency: currency, ...(plan ? { plan } : {}) }))
                  if (res.emailed) {
                    toast.success(`${name} created. The owner has an invite in their inbox.`)
                    setOpen(false)
                    reset()
                    router.push(`/platform/workspaces/${res.workspaceId}`)
                  } else setShared({ id: res.workspaceId, url: res.inviteUrl })
                } catch (err) {
                  if (!isCancelled(err)) toast.error(err instanceof Error ? err.message : "Could not create the company")
                }
              }}
            >
              <DialogHeader>
                <DialogTitle>New company</DialogTitle>
                <DialogDescription>For a customer you&apos;re onboarding yourself. The owner gets an email to set their password and sign in.</DialogDescription>
              </DialogHeader>
              <Field>
                <FieldLabel htmlFor="new-company-name">Company name</FieldLabel>
                <Input id="new-company-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={64} data-testid="new-company-name" />
              </Field>
              <Field>
                <FieldLabel htmlFor="new-company-owner">Owner&apos;s email</FieldLabel>
                <Input id="new-company-owner" type="email" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} data-testid="new-company-owner" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field>
                  <FieldLabel>Plan</FieldLabel>
                  <Select value={plan} onValueChange={setPlan}>
                    <SelectTrigger aria-label="Plan">
                      <SelectValue placeholder="Sign-up plan" />
                    </SelectTrigger>
                    <SelectContent>
                      {active.map((p) => (
                        <SelectItem key={p.id} value={p.slug}>
                          {p.name}
                          {!p.public ? " (private)" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel>Billed in</FieldLabel>
                  <Select value={currency} onValueChange={(v) => setCurrency(v as "NGN" | "USD")}>
                    <SelectTrigger aria-label="Billing currency">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="NGN">Naira (NGN)</SelectItem>
                      <SelectItem value="USD">US dollars (USD)</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              <FieldDescription>The plan&apos;s trial starts with the company&apos;s first live payment.</FieldDescription>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={create.isPending || name.trim().length < 2 || !ownerEmail.includes("@")} data-testid="create-company">
                  {create.isPending && <Loader2 className="animate-spin" />}
                  Create company
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
