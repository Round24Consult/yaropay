"use client"

// YaroPay Enterprise License: see LICENSE.md in the parent folder.

import { type BillingCurrency, type Invoice, periodLabel } from "@yaropay/core/billing"
import { formatCount, formatMoney } from "@yaropay/core/money"
import type { PlatformWorkspaceDetail } from "@yaropay/core/platform"
import { useQueryClient } from "@tanstack/react-query"
import { AlertTriangle, ArrowLeft, Eye, Loader2, ShieldCheck } from "lucide-react"
import type { Role } from "@yaropay/core/auth"
import Link from "next/link"
import { useRouter } from "next/navigation"
import * as React from "react"
import { toast } from "sonner"
import { roleLabel } from "@/components/layout/user-menu"
import { Panel, PanelHeader } from "@/components/shared/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { CopyField } from "@/components/shared/copy-field"
import { setActiveWorkspace } from "@/lib/api/client"
import { navigateAfterAuth } from "@/lib/forms"
import { formatDate, formatDateTime, formatRelative } from "@/lib/format"
import {
  useDeleteWorkspace,
  useInviteAction,
  useMarkInvoicePaid,
  useMemberAction,
  usePlatformInvite,
  useRenameWorkspace,
  usePlans,
  usePlatformWorkspace,
  useResumeWorkspace,
  useStartSupport,
  useSuspendWorkspace,
  useUpdateWorkspaceBilling,
  useVoidInvoice,
} from "./hooks"
import { isCancelled, PlatformShell, useGuarded } from "./platform-shell"

const toDateInput = (iso: string | null) => (iso ? iso.slice(0, 10) : "")
const fromDateInput = (v: string) => (v ? new Date(`${v}T00:00:00.000Z`).toISOString() : null)

export function WorkspaceDetailPage({ id }: { id: string }) {
  const { data, error } = usePlatformWorkspace(id)
  return (
    <PlatformShell title={data?.name ?? "Company"} description={data ? `${data.slug} · joined ${formatDate(data.createdAt)}` : undefined} actions={data ? <StatusActions w={data} /> : null}>
      <Link href="/platform" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> All companies
      </Link>
      {error ? (
        <Panel className="p-6 text-sm text-muted-foreground">{error.message}</Panel>
      ) : !data ? (
        <Skeleton className="h-64 rounded-2xl" />
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="min-w-0 space-y-6 lg:col-span-2">
            {data.status === "suspended" && (
              <div className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm" role="alert" data-testid="suspended-banner">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
                <p>
                  Suspended {data.suspendedAt ? formatRelative(data.suspendedAt) : ""}: {data.suspendedReason}. Members can&apos;t sign in and new payments are refused; payments already started still complete.
                </p>
              </div>
            )}
            <ThisMonth w={data} />
            <Invoices w={data} />
            <Team w={data} />
            <Products w={data} />
            <Audit w={data} />
          </div>
          <div className="min-w-0 space-y-6">
            {/* Remounts (fresh fields) whenever the saved values change. */}
            <BillingForm key={`${data.plan}|${data.billingCurrency}|${data.trialEndsAt}|${data.freeUntil}`} w={data} />
            <Health w={data} />
          </div>
        </div>
      )}
    </PlatformShell>
  )
}

function StatusActions({ w }: { w: PlatformWorkspaceDetail }) {
  return (
    <>
      <SupportAction w={w} />
      <RenameAction w={w} />
      <SuspendResume w={w} />
      {w.status === "suspended" && <DeleteAction w={w} />}
    </>
  )
}

function RenameAction({ w }: { w: PlatformWorkspaceDetail }) {
  const guarded = useGuarded()
  const rename = useRenameWorkspace(w.id)
  const [open, setOpen] = React.useState(false)
  const [name, setName] = React.useState(w.name)
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)} data-testid="rename-company">
        Rename
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault()
              try {
                await guarded(() => rename.mutateAsync(name))
                toast.success("Company renamed")
                setOpen(false)
              } catch (err) {
                if (!isCancelled(err)) toast.error(err instanceof Error ? err.message : "Could not rename")
              }
            }}
          >
            <DialogHeader>
              <DialogTitle>Rename {w.name}</DialogTitle>
              <DialogDescription>The new name shows in their dashboard, emails and invoices from now on. It&apos;s recorded in their audit log.</DialogDescription>
            </DialogHeader>
            <Field>
              <FieldLabel htmlFor="rename-company">Company name</FieldLabel>
              <Input id="rename-company" value={name} onChange={(e) => setName(e.target.value)} maxLength={64} data-testid="rename-company-name" />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={rename.isPending || name.trim().length < 2 || name.trim() === w.name}>
                {rename.isPending && <Loader2 className="animate-spin" />}
                Save name
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

/** The last step of closing a company: only once suspended, paid up, and its name typed back. */
function DeleteAction({ w }: { w: PlatformWorkspaceDetail }) {
  const router = useRouter()
  const guarded = useGuarded()
  const remove = useDeleteWorkspace(w.id)
  const [open, setOpen] = React.useState(false)
  const [typed, setTyped] = React.useState("")
  const openInvoices = w.invoices.filter((i) => i.status === "open").length
  return (
    <>
      <Button size="sm" variant="destructive" onClick={() => setOpen(true)} data-testid="delete-company">
        Delete
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault()
              try {
                await guarded(() => remove.mutateAsync(typed))
                toast.success(`${w.name} deleted`)
                router.push("/platform")
              } catch (err) {
                if (!isCancelled(err)) toast.error(err instanceof Error ? err.message : "Could not delete")
              }
            }}
          >
            <DialogHeader>
              <DialogTitle>Delete {w.name} for good?</DialogTitle>
              <DialogDescription>
                This removes its gateway accounts, products, every payment record, webhooks, invoices and team access. It can&apos;t be undone, and YaroPay can&apos;t restore it
                except from a server backup. People keep their accounts if they belong to other companies.
              </DialogDescription>
            </DialogHeader>
            {openInvoices > 0 && (
              <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {openInvoices} unpaid invoice{openInvoices === 1 ? "" : "s"}: mark {openInvoices === 1 ? "it" : "them"} paid or void {openInvoices === 1 ? "it" : "them"} first.
              </p>
            )}
            <Field>
              <FieldLabel htmlFor="confirm-delete">
                Type <span className="font-mono">{w.name}</span> to confirm
              </FieldLabel>
              <Input id="confirm-delete" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" data-testid="confirm-delete-name" />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="destructive" disabled={remove.isPending || typed !== w.name || openInvoices > 0} data-testid="confirm-delete">
                {remove.isPending && <Loader2 className="animate-spin" />}
                Delete company
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

/** A read-only look at the company's dashboard, with a reason the owners see. */
function SupportAction({ w }: { w: PlatformWorkspaceDetail }) {
  const guarded = useGuarded()
  const qc = useQueryClient()
  const start = useStartSupport(w.id)
  const [open, setOpen] = React.useState(false)
  const [reason, setReason] = React.useState("")
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)} disabled={w.status === "suspended"} data-testid="open-support">
        <Eye /> Support view
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault()
              try {
                await guarded(() => start.mutateAsync({ reason }))
                // Same browser session, now looking at the company: start the dashboard afresh.
                qc.clear()
                setActiveWorkspace(w.id)
                navigateAfterAuth("/")
              } catch (err) {
                if (!isCancelled(err)) toast.error(err instanceof Error ? err.message : "Could not open the support view")
              }
            }}
          >
            <DialogHeader>
              <DialogTitle>Open a support view of {w.name}?</DialogTitle>
              <DialogDescription>
                You&apos;ll see their dashboard read-only for up to an hour; nothing can be changed. It&apos;s recorded in their audit log and their owners get an email with your reason.
              </DialogDescription>
            </DialogHeader>
            <Field>
              <FieldLabel htmlFor="support-reason">Reason</FieldLabel>
              <Textarea id="support-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ticket 42: webhooks not arriving" maxLength={300} />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={start.isPending || reason.trim().length < 5} data-testid="confirm-support">
                {start.isPending && <Loader2 className="animate-spin" />}
                Open support view
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

function SuspendResume({ w }: { w: PlatformWorkspaceDetail }) {
  const guarded = useGuarded()
  const resume = useResumeWorkspace(w.id)
  const [open, setOpen] = React.useState(false)
  if (w.status === "suspended") {
    return (
      <Button
        size="sm"
        variant="outline"
        disabled={resume.isPending}
        onClick={async () => {
          try {
            await guarded(() => resume.mutateAsync())
            toast.success(`${w.name} is active again`)
          } catch (e) {
            if (!isCancelled(e)) toast.error(e instanceof Error ? e.message : "Could not resume")
          }
        }}
        data-testid="resume-workspace"
      >
        {resume.isPending && <Loader2 className="animate-spin" />}
        Resume
      </Button>
    )
  }
  return (
    <>
      <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={() => setOpen(true)} data-testid="suspend-workspace">
        Suspend
      </Button>
      <SuspendDialog w={w} open={open} onOpenChange={setOpen} />
    </>
  )
}

function SuspendDialog({ w, open, onOpenChange }: { w: PlatformWorkspaceDetail; open: boolean; onOpenChange: (o: boolean) => void }) {
  const guarded = useGuarded()
  const suspend = useSuspendWorkspace(w.id)
  const [reason, setReason] = React.useState("")
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          onSubmit={async (e) => {
            e.preventDefault()
            try {
              await guarded(() => suspend.mutateAsync({ reason }))
              toast.success(`${w.name} is suspended`)
              onOpenChange(false)
            } catch (err) {
              if (!isCancelled(err)) toast.error(err instanceof Error ? err.message : "Could not suspend")
            }
          }}
          className="space-y-4"
        >
          <DialogHeader>
            <DialogTitle>Suspend {w.name}?</DialogTitle>
            <DialogDescription>
              Members lose the dashboard and new payments are refused. Payments already started still complete and reach their products. The owners get an email with your reason.
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="suspend-reason">Reason</FieldLabel>
            <Textarea id="suspend-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example: three unpaid invoices" maxLength={300} />
            <FieldDescription>Shown to the company and kept in both audit logs.</FieldDescription>
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={suspend.isPending || reason.trim().length < 3} data-testid="confirm-suspend">
              {suspend.isPending && <Loader2 className="animate-spin" />}
              Suspend
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ThisMonth({ w }: { w: PlatformWorkspaceDetail }) {
  const now = new Date()
  const inTrial = w.trialEndsAt && new Date(w.trialEndsAt) > now
  const free = w.freeUntil && new Date(w.freeUntil) > now
  return (
    <Panel data-testid="this-month">
      <PanelHeader
        title="This month so far"
        description={w.planName ? `${w.planName} plan, billed in ${w.billingCurrency}.` : `Plan "${w.plan}" isn't a Cloud plan, so nothing is billed.`}
      />
      <div className="space-y-4 p-5 pt-3">
        {w.pendingTrialDays !== null && (
          <p className="rounded-lg bg-muted/60 px-3 py-2 text-sm">No live payments yet. A {w.pendingTrialDays}-day trial starts with the first one.</p>
        )}
        {(inTrial || free) && (
          <p className="rounded-lg bg-muted/60 px-3 py-2 text-sm">
            {inTrial ? `In trial until ${formatDate(w.trialEndsAt!)}` : `Free until ${formatDate(w.freeUntil!)}`}: live use before then isn&apos;t billed.
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs font-medium text-muted-foreground">Live products</p>
            {w.usage.liveProducts.length ? (
              <ul className="mt-1 space-y-0.5 text-sm">
                {w.usage.liveProducts.map((p) => (
                  <li key={p.id}>{p.name}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">None yet</p>
            )}
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground">Live volume</p>
            {w.usage.volume.length ? (
              <ul className="mt-1 space-y-0.5 text-sm tabular-nums">
                {w.usage.volume.map((v) => (
                  <li key={v.currency}>
                    {formatMoney(v.amount, v.currency)} <span className="text-muted-foreground">· {formatCount(v.count)} payments</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">None yet</p>
            )}
          </div>
        </div>
        {w.priced && (
          <div className="rounded-lg border">
            <Table>
              <TableBody>
                {w.priced.lines.map((l, i) => (
                  <TableRow key={i}>
                    <TableCell className="pl-4 text-sm">{l.description}</TableCell>
                    <TableCell className="pr-4 text-right text-sm tabular-nums">{formatMoney(l.amount, w.priced!.currency)}</TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell className="pl-4 text-sm font-medium">Total so far</TableCell>
                  <TableCell className="pr-4 text-right text-sm font-semibold tabular-nums" data-testid="month-total">
                    {formatMoney(w.priced.total, w.priced.currency)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        )}
        {w.priced && w.priced.unconverted.length > 0 && (
          <p className="text-xs text-warning-text">Volume in {w.priced.unconverted.join(", ")} has no exchange rate and isn&apos;t counted.</p>
        )}
      </div>
    </Panel>
  )
}

function BillingForm({ w }: { w: PlatformWorkspaceDetail }) {
  const { data: plans } = usePlans()
  const guarded = useGuarded()
  const update = useUpdateWorkspaceBilling(w.id)
  const [plan, setPlan] = React.useState(w.plan)
  const [currency, setCurrency] = React.useState<BillingCurrency>(w.billingCurrency)
  const [trialEnds, setTrialEnds] = React.useState(toDateInput(w.trialEndsAt))
  const [freeUntil, setFreeUntil] = React.useState(toDateInput(w.freeUntil))

  const dirty = plan !== w.plan || currency !== w.billingCurrency || trialEnds !== toDateInput(w.trialEndsAt) || freeUntil !== toDateInput(w.freeUntil)
  const options = (plans ?? []).filter((p) => p.active || p.slug === w.plan)
  return (
    <Panel>
      <PanelHeader title="Billing" description="Plan, currency, trial and free months. Changes apply to this month's bill." />
      <div className="mx-5 mt-3 rounded-lg bg-muted/60 px-3 py-2 text-sm" data-testid="company-card">
        {w.card ? (
          <span className="capitalize">
            {w.card.brand || "Card"} ending {w.card.last4}, expires {w.card.expMonth}/{w.card.expYear}
          </span>
        ) : (
          "No card saved: invoices wait for the company to pay."
        )}
        {w.billingStatus === "past_due" && <span className="mt-1 block font-medium text-destructive">Overdue: paid features paused.</span>}
      </div>
      <form
        className="space-y-4 p-5 pt-3"
        onSubmit={async (e) => {
          e.preventDefault()
          try {
            await guarded(() =>
              update.mutateAsync({
                ...(plan !== w.plan ? { plan } : {}),
                ...(currency !== w.billingCurrency ? { billingCurrency: currency } : {}),
                ...(trialEnds !== toDateInput(w.trialEndsAt) ? { trialEndsAt: fromDateInput(trialEnds) } : {}),
                ...(freeUntil !== toDateInput(w.freeUntil) ? { freeUntil: fromDateInput(freeUntil) } : {}),
              }),
            )
            toast.success("Billing saved")
          } catch (err) {
            if (!isCancelled(err)) toast.error(err instanceof Error ? err.message : "Could not save")
          }
        }}
      >
        <Field>
          <FieldLabel>Plan</FieldLabel>
          <Select value={plan} onValueChange={setPlan}>
            <SelectTrigger aria-label="Plan" data-testid="billing-plan">
              <SelectValue placeholder="Pick a plan" />
            </SelectTrigger>
            <SelectContent>
              {!options.some((p) => p.slug === w.plan) && <SelectItem value={w.plan}>{w.plan} (not a Cloud plan)</SelectItem>}
              {options.map((p) => (
                <SelectItem key={p.id} value={p.slug}>
                  {p.name}
                  {!p.public ? " (private)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel>Billing currency</FieldLabel>
          <Select value={currency} onValueChange={(v) => setCurrency(v as BillingCurrency)}>
            <SelectTrigger aria-label="Billing currency">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="NGN">Naira (NGN)</SelectItem>
              <SelectItem value="USD">US dollar (USD)</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor="trial-ends">Trial ends</FieldLabel>
          <Input id="trial-ends" type="date" value={trialEnds} onChange={(e) => setTrialEnds(e.target.value)} />
          <FieldDescription>Set by the first live payment. Move it to extend the trial; clear it to end it.</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="free-until">Free until</FieldLabel>
          <Input id="free-until" type="date" value={freeUntil} onChange={(e) => setFreeUntil(e.target.value)} />
          <FieldDescription>Free months: live use before this date isn&apos;t billed.</FieldDescription>
        </Field>
        <Button type="submit" size="sm" disabled={!dirty || update.isPending} data-testid="save-billing">
          {update.isPending && <Loader2 className="animate-spin" />}
          Save billing
        </Button>
      </form>
    </Panel>
  )
}

const ROLE_OPTIONS: Role[] = ["owner", "admin", "developer", "finance", "viewer"]

function Team({ w }: { w: PlatformWorkspaceDetail }) {
  const guarded = useGuarded()
  const members = useMemberAction(w.id)
  const inviteAction = useInviteAction(w.id)
  const [removing, setRemoving] = React.useState<PlatformWorkspaceDetail["team"][number] | null>(null)
  const active = w.team.filter((m) => !m.disabled)
  const run = async (fn: () => Promise<unknown>, done: string) => {
    try {
      await guarded(fn)
      toast.success(done)
    } catch (err) {
      if (!isCancelled(err)) toast.error(err instanceof Error ? err.message : "Could not save")
    }
  }
  return (
    <Panel className="overflow-hidden" data-testid="company-team">
      <PanelHeader title="Team" description={`${active.length} ${active.length === 1 ? "person" : "people"}. Changes are recorded in their audit log as YaroPay support.`} actions={<InviteMember w={w} />} />
      <div className="mt-3 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-5">Name</TableHead>
              <TableHead>Role</TableHead>
              <TableHead className="hidden sm:table-cell">Two-step</TableHead>
              <TableHead className="hidden md:table-cell">Last active</TableHead>
              <TableHead className="pr-5" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {w.team.map((m) => (
              <TableRow key={m.id} className={m.disabled ? "opacity-60" : undefined} data-testid={`team-${m.email}`}>
                <TableCell className="pl-5">
                  <p className="font-medium">{m.name}</p>
                  <p className="text-xs text-muted-foreground">{m.email}</p>
                </TableCell>
                <TableCell>
                  {m.disabled ? (
                    <span className="text-sm">Removed</span>
                  ) : (
                    <Select value={m.role} onValueChange={(role) => void run(() => members.mutateAsync({ userId: m.id, role: role as Role }), `${m.name} is now ${roleLabel(role as Role).toLowerCase()}`)}>
                      <SelectTrigger className="h-8 w-32" aria-label={`Role of ${m.name}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ROLE_OPTIONS.map((r) => (
                          <SelectItem key={r} value={r}>
                            {roleLabel(r)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </TableCell>
                <TableCell className="hidden sm:table-cell">{m.mfaEnabled ? <ShieldCheck className="size-4 text-good-text" aria-label="On" /> : <span className="text-xs text-muted-foreground">Off</span>}</TableCell>
                <TableCell className="hidden text-xs text-muted-foreground md:table-cell">{m.lastActiveAt ? formatRelative(m.lastActiveAt) : "Never"}</TableCell>
                <TableCell className="pr-5 text-right">
                  {!m.disabled && (
                    <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setRemoving(m)} aria-label={`Remove ${m.name}`}>
                      Remove
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {w.invites.map((i) => (
              <TableRow key={i.id} data-testid={`invite-${i.email}`}>
                <TableCell className="pl-5">
                  <p className="font-medium">{i.email}</p>
                  <p className="text-xs text-muted-foreground">
                    {i.expired ? "Invite expired" : `Invited ${formatRelative(i.createdAt)} by ${i.invitedBy}`}
                  </p>
                </TableCell>
                <TableCell className="text-sm">{roleLabel(i.role)}</TableCell>
                <TableCell className="hidden sm:table-cell" />
                <TableCell className="hidden md:table-cell">
                  <Badge variant="outline">Pending</Badge>
                </TableCell>
                <TableCell className="pr-5 text-right whitespace-nowrap">
                  <Button size="sm" variant="ghost" onClick={() => void run(() => inviteAction.mutateAsync({ inviteId: i.id, kind: "resend" }), `Invite sent again to ${i.email}`)}>
                    Resend
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-muted-foreground"
                    onClick={() => void run(() => inviteAction.mutateAsync({ inviteId: i.id, kind: "revoke" }), `Invite to ${i.email} revoked`)}
                  >
                    Revoke
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <Dialog open={removing !== null} onOpenChange={(o) => !o && setRemoving(null)}>
        <DialogContent>
          {removing && (
            <>
              <DialogHeader>
                <DialogTitle>Remove {removing.name} from {w.name}?</DialogTitle>
                <DialogDescription>They&apos;re signed out of this company straight away. Their account and any other companies they belong to stay.</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setRemoving(null)}>
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  disabled={members.isPending}
                  onClick={async () => {
                    await run(() => members.mutateAsync({ userId: removing.id, remove: true }), `${removing.name} removed`)
                    setRemoving(null)
                  }}
                >
                  {members.isPending && <Loader2 className="animate-spin" />}
                  Remove
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </Panel>
  )
}

function InviteMember({ w }: { w: PlatformWorkspaceDetail }) {
  const guarded = useGuarded()
  const invite = usePlatformInvite(w.id)
  const [open, setOpen] = React.useState(false)
  const [email, setEmail] = React.useState("")
  const [role, setRole] = React.useState<Role>("admin")
  const [link, setLink] = React.useState<string | null>(null)
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)} data-testid="invite-to-company">
        Invite
      </Button>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o)
          if (!o) {
            setEmail("")
            setLink(null)
          }
        }}
      >
        <DialogContent>
          {link ? (
            <div className="space-y-4">
              <DialogHeader>
                <DialogTitle>Invite created</DialogTitle>
                <DialogDescription>Email isn&apos;t set up, so share this link yourself. It works for 7 days.</DialogDescription>
              </DialogHeader>
              <CopyField label="Invite link" value={link} />
            </div>
          ) : (
            <form
              className="space-y-4"
              onSubmit={async (e) => {
                e.preventDefault()
                try {
                  const res = await guarded(() => invite.mutateAsync({ email, role }))
                  if (res.emailed) {
                    toast.success(`Invite sent to ${email}`)
                    setOpen(false)
                    setEmail("")
                  } else setLink(res.inviteUrl)
                } catch (err) {
                  if (!isCancelled(err)) toast.error(err instanceof Error ? err.message : "Could not invite")
                }
              }}
            >
              <DialogHeader>
                <DialogTitle>Invite someone to {w.name}</DialogTitle>
                <DialogDescription>To hand a company to a new owner, invite them as Owner, then change or remove the old one.</DialogDescription>
              </DialogHeader>
              <Field>
                <FieldLabel htmlFor="invite-email">Email</FieldLabel>
                <Input id="invite-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </Field>
              <Field>
                <FieldLabel>Role</FieldLabel>
                <Select value={role} onValueChange={(r) => setRole(r as Role)}>
                  <SelectTrigger aria-label="Role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLE_OPTIONS.map((r) => (
                      <SelectItem key={r} value={r}>
                        {roleLabel(r)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={invite.isPending || !email.includes("@")}>
                  {invite.isPending && <Loader2 className="animate-spin" />}
                  Send invite
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

function Products({ w }: { w: PlatformWorkspaceDetail }) {
  return (
    <Panel>
      <PanelHeader title="Products" description="Names and status only: keys, secrets and payment details stay with the company." />
      <ul className="mt-3 divide-y border-t">
        {w.products.map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
            <span className="font-medium">{p.name}</span>
            <span className="flex flex-wrap items-center gap-1.5">
              {p.sample && <Badge variant="outline">Sample</Badge>}
              {p.status !== "active" && <Badge variant="secondary">Paused</Badge>}
              {p.liveThisMonth ? <Badge>Live this month</Badge> : <span className="text-xs text-muted-foreground">No live payments this month</span>}
            </span>
          </li>
        ))}
        {w.products.length === 0 && <li className="px-5 py-6 text-center text-sm text-muted-foreground">No products yet.</li>}
      </ul>
    </Panel>
  )
}

function Health({ w }: { w: PlatformWorkspaceDetail }) {
  return (
    <Panel>
      <PanelHeader title="Health" description="Live mode, last 7 days." />
      <dl className="grid grid-cols-2 gap-4 p-5 pt-3 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">Failed deliveries</dt>
          <dd className="text-lg font-semibold tabular-nums">{w.health.failedDeliveries7d}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Unrouted events</dt>
          <dd className="text-lg font-semibold tabular-nums">{w.health.unroutedEvents7d}</dd>
        </div>
        <div className="col-span-2">
          <dt className="text-xs text-muted-foreground">Gateway accounts</dt>
          <dd className="mt-1">
            {w.gateways.length
              ? w.gateways.map((g) => (
                  <Badge key={`${g.gatewayId}-${g.mode}`} variant="outline" className="mr-1.5 capitalize">
                    {g.gatewayId} · {g.mode} × {g.count}
                  </Badge>
                ))
              : "None"}
          </dd>
        </div>
      </dl>
    </Panel>
  )
}

function Audit({ w }: { w: PlatformWorkspaceDetail }) {
  return (
    <Panel>
      <PanelHeader title="Platform actions" description="What the YaroPay team changed for this company." />
      <ul className="mt-3 divide-y border-t">
        {w.audit.map((a) => (
          <li key={a.id} className="flex items-start justify-between gap-3 px-5 py-2.5 text-sm">
            <span>
              <span className="font-medium">{a.actorEmail}</span> <span className="text-muted-foreground">{a.action.toLowerCase()}</span>
              {typeof a.detail.reason === "string" && <span className="text-muted-foreground">: {a.detail.reason}</span>}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground" title={formatDateTime(a.at)}>
              {formatRelative(a.at)}
            </span>
          </li>
        ))}
        {w.audit.length === 0 && <li className="px-5 py-6 text-center text-sm text-muted-foreground">Nothing yet.</li>}
      </ul>
    </Panel>
  )
}

function Invoices({ w }: { w: PlatformWorkspaceDetail }) {
  const [acting, setActing] = React.useState<{ invoice: Invoice; kind: "paid" | "void" } | null>(null)
  return (
    <Panel className="overflow-hidden">
      <PanelHeader title="Invoices" description="Written at the start of each month for the month before." />
      <div className="mt-3 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-5">Invoice</TableHead>
              <TableHead>Month</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="pr-5 text-right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {w.invoices.map((i) => (
              <TableRow key={i.id}>
                <TableCell className="pl-5 font-mono text-xs">{i.number}</TableCell>
                <TableCell className="text-sm">{periodLabel(i.period)}</TableCell>
                <TableCell className="text-right text-sm tabular-nums">{formatMoney(i.total, i.currency)}</TableCell>
                <TableCell className="text-sm">
                  {i.status === "open" ? (new Date(i.dueAt) < new Date() ? <Badge variant="destructive">Overdue</Badge> : <Badge>Open</Badge>) : i.status === "paid" ? "Paid" : "Void"}
                  {i.note && <p className="text-xs text-muted-foreground">{i.note}</p>}
                </TableCell>
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
            ))}
            {w.invoices.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                  No invoices yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <Dialog open={acting !== null} onOpenChange={(o) => !o && setActing(null)}>
        <DialogContent>{acting && <InvoiceAction {...acting} onDone={() => setActing(null)} />}</DialogContent>
      </Dialog>
    </Panel>
  )
}

function InvoiceAction({ invoice, kind, onDone }: { invoice: Invoice; kind: "paid" | "void"; onDone: () => void }) {
  const guarded = useGuarded()
  const markPaid = useMarkInvoicePaid()
  const voidIt = useVoidInvoice()
  const [text, setText] = React.useState("")
  const pending = markPaid.isPending || voidIt.isPending
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault()
        try {
          if (kind === "paid") await guarded(() => markPaid.mutateAsync({ id: invoice.id, note: text.trim() || undefined }))
          else await guarded(() => voidIt.mutateAsync({ id: invoice.id, reason: text }))
          toast.success(kind === "paid" ? `${invoice.number} marked paid` : `${invoice.number} voided`)
          onDone()
        } catch (err) {
          if (!isCancelled(err)) toast.error(err instanceof Error ? err.message : "Could not update the invoice")
        }
      }}
    >
      <DialogHeader>
        <DialogTitle>{kind === "paid" ? `Mark ${invoice.number} paid?` : `Void ${invoice.number}?`}</DialogTitle>
        <DialogDescription>
          {kind === "paid"
            ? `For a payment that came in some other way, like a bank transfer of ${formatMoney(invoice.total, invoice.currency)}.`
            : "The company won't be asked to pay it. This can't be undone."}
        </DialogDescription>
      </DialogHeader>
      <Field>
        <FieldLabel htmlFor="invoice-note">{kind === "paid" ? "Note (optional)" : "Reason"}</FieldLabel>
        <Input id="invoice-note" value={text} onChange={(e) => setText(e.target.value)} maxLength={200} placeholder={kind === "paid" ? "Bank transfer, 12 Dec" : "Goodwill: launch month"} />
      </Field>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant={kind === "void" ? "destructive" : "default"} disabled={pending || (kind === "void" && text.trim().length < 3)}>
          {pending && <Loader2 className="animate-spin" />}
          {kind === "paid" ? "Mark paid" : "Void invoice"}
        </Button>
      </DialogFooter>
    </form>
  )
}
