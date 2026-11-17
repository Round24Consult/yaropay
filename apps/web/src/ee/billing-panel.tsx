"use client"

// YaroPay Enterprise License: see LICENSE.md in this folder.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  type BillingSummary,
  type Checkout,
  type CheckoutResult,
  type Invoice,
  type InvoiceStatus,
  periodLabel,
  type PriceSchedule,
} from "@yaropay/core/billing"
import { formatCount, formatMoney } from "@yaropay/core/money"
import { AlertTriangle, CreditCard, Loader2, Receipt } from "lucide-react"
import Link from "next/link"
import * as React from "react"
import { toast } from "sonner"
import { Panel, PanelHeader } from "@/components/shared/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { api } from "@/lib/api/client"
import { useEntitlements } from "@/lib/api/hooks"
import { useCan } from "@/lib/auth"
import { formatDate } from "@/lib/format"

export function useBilling(opts: { enabled?: boolean } = {}) {
  return useQuery({ queryKey: ["billing"], queryFn: () => api<BillingSummary>("/billing"), enabled: opts.enabled ?? true, staleTime: 60_000 })
}

/** Starts a Paystack checkout and sends the browser there. */
function useCheckout(path: () => string) {
  return useMutation({
    mutationFn: () => api<Checkout>(path(), { method: "POST" }),
    onSuccess: (c) => window.location.assign(c.authorizationUrl),
  })
}

function useRemoveCard() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api<{ ok: true }>("/billing/card", { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["billing"] }),
  })
}

function priceText(s: PriceSchedule, currency: "NGN" | "USD") {
  const per = `${formatMoney(s.perLiveProduct[currency], currency, { decimals: currency === "USD" })} per live product a month`
  if (!s.volumeFee.enabled || s.volumeFee.rateBps === 0) return per
  const pct = (s.volumeFee.rateBps / 100).toLocaleString("en", { maximumFractionDigits: 2 })
  return `${per}, plus ${pct}% of live volume above ${formatMoney(s.volumeFee.threshold[currency], currency, { decimals: false })} a month`
}

const STATUS: Record<InvoiceStatus, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  open: { label: "To pay", variant: "default" },
  paid: { label: "Paid", variant: "secondary" },
  void: { label: "Cancelled", variant: "outline" },
}

/** YaroPay Cloud: the company's plan, this month so far and its invoices. */
export function BillingPanel() {
  const { data, isLoading } = useBilling()
  const [open, setOpen] = React.useState<Invoice | null>(null)
  if (isLoading || !data) return <Skeleton className="h-96 rounded-2xl" />
  const now = new Date()
  const inTrial = data.trialEndsAt && new Date(data.trialEndsAt) > now
  const free = data.freeUntil && new Date(data.freeUntil) > now
  const priced = data.thisMonth.priced
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="min-w-0 space-y-6 lg:col-span-2">
        {data.billingStatus === "past_due" && <PastDueNotice />}
        <Panel data-testid="billing-this-month">
          <PanelHeader title="This month so far" description="A product counts once it takes a live payment this month. Test mode is free." />
          <div className="space-y-4 p-5 pt-3">
            {data.pendingTrialDays !== null && (
              <p className="rounded-lg bg-muted/60 px-3 py-2 text-sm">
                Test mode is free. Your {data.pendingTrialDays}-day free trial starts with your first live payment.
              </p>
            )}
            {(inTrial || free) && (
              <p className="rounded-lg bg-muted/60 px-3 py-2 text-sm">
                {inTrial ? `Your free trial runs until ${formatDate(data.trialEndsAt!)}.` : `Free until ${formatDate(data.freeUntil!)}.`} Live payments before
                then aren&apos;t billed.
              </p>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-xs font-medium text-muted-foreground">Live products</p>
                {data.thisMonth.usage.liveProducts.length ? (
                  <ul className="mt-1 space-y-0.5 text-sm">
                    {data.thisMonth.usage.liveProducts.map((p) => (
                      <li key={p.id}>{p.name}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-sm text-muted-foreground">None yet</p>
                )}
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">Live volume</p>
                {data.thisMonth.usage.volume.length ? (
                  <ul className="mt-1 space-y-0.5 text-sm tabular-nums">
                    {data.thisMonth.usage.volume.map((v) => (
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
            {priced && (
              <div className="flex items-baseline justify-between border-t pt-3">
                <span className="text-sm text-muted-foreground">Billed so far</span>
                <span className="text-lg font-semibold tabular-nums" data-testid="billing-so-far">
                  {formatMoney(priced.total, priced.currency)}
                </span>
              </div>
            )}
          </div>
        </Panel>

        <Panel className="overflow-hidden">
          <PanelHeader title="Invoices" description="One at the start of each month for the month before. Nothing is ever taken out of your payments." />
          <div className="mt-3 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5">Invoice</TableHead>
                  <TableHead>Month</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="pr-5 text-right">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.invoices.map((i) => (
                  <TableRow key={i.id} className="cursor-pointer" onClick={() => setOpen(i)} data-testid={`invoice-${i.number}`}>
                    <TableCell className="pl-5 font-mono text-xs">{i.number}</TableCell>
                    <TableCell className="text-sm">{periodLabel(i.period)}</TableCell>
                    <TableCell className="text-right text-sm tabular-nums">{formatMoney(i.total, i.currency)}</TableCell>
                    <TableCell className="pr-5 text-right">
                      <Badge variant={STATUS[i.status].variant}>{STATUS[i.status].label}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
                {data.invoices.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="py-10 text-center text-sm text-muted-foreground">
                      No invoices yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </Panel>
      </div>

      <div className="min-w-0 space-y-6">
        <Panel>
          <PanelHeader title="Your plan" />
          <div className="space-y-2 p-5 pt-3 text-sm">
            {data.plan ? (
              <>
                <p className="text-base font-semibold">{data.plan.name}</p>
                <p className="text-muted-foreground">{priceText(data.plan.price.schedule, data.billingCurrency)}</p>
                {data.plan.nextPrice && (
                  <p className="rounded-lg bg-muted/60 px-3 py-2 text-xs">
                    From {formatDate(data.plan.nextPrice.effectiveFrom)}: {priceText(data.plan.nextPrice.schedule, data.billingCurrency)}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">Billed in {data.billingCurrency === "NGN" ? "naira" : "US dollars"}.</p>
              </>
            ) : (
              <p className="text-muted-foreground">No plan yet. Contact YaroPay to choose one.</p>
            )}
          </div>
        </Panel>
        <PaymentMethod data={data} />
      </div>

      <Dialog open={open !== null} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="sm:max-w-md">{open && <InvoiceDetail invoice={open} cardPayments={data.cardPayments} />}</DialogContent>
      </Dialog>
    </div>
  )
}

function InvoiceDetail({ invoice, cardPayments }: { invoice: Invoice; cardPayments: boolean }) {
  const canPay = useCan("settings:write")
  const pay = useCheckout(() => `/billing/invoices/${invoice.id}/pay`)
  return (
    <div className="space-y-4">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Receipt className="size-4" aria-hidden /> {invoice.number}
        </DialogTitle>
        <DialogDescription>
          {invoice.planName} plan, {periodLabel(invoice.period)}. Issued {formatDate(invoice.issuedAt)}
          {invoice.status === "open" ? `, due ${formatDate(invoice.dueAt)}` : invoice.paidAt ? `, paid ${formatDate(invoice.paidAt)}` : ""}.
        </DialogDescription>
      </DialogHeader>
      <div className="rounded-lg border">
        <Table>
          <TableBody>
            {invoice.lines.map((l, i) => (
              <TableRow key={i}>
                <TableCell className="pl-4 text-sm">{l.description}</TableCell>
                <TableCell className="pr-4 text-right text-sm tabular-nums">{formatMoney(l.amount, invoice.currency)}</TableCell>
              </TableRow>
            ))}
            <TableRow>
              <TableCell className="pl-4 text-sm font-medium">Total</TableCell>
              <TableCell className="pr-4 text-right text-sm font-semibold tabular-nums">{formatMoney(invoice.total, invoice.currency)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
      {invoice.status === "open" && invoice.lastError && <p className="text-xs text-destructive">Last card charge failed: {invoice.lastError}</p>}
      {invoice.status === "open" &&
        (cardPayments && canPay ? (
          <Button
            className="w-full"
            disabled={pay.isPending}
            onClick={() => pay.mutate(undefined, { onError: (e) => toast.error(e.message) })}
            data-testid="pay-invoice"
          >
            {pay.isPending && <Loader2 className="animate-spin" />}
            Pay {formatMoney(invoice.total, invoice.currency)} by card
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">
            {cardPayments
              ? "An owner or admin can pay this by card."
              : "To pay, reply to the invoice email and we'll send the details. Card payments are coming soon."}
          </p>
        ))}
      {invoice.note && <p className="text-xs text-muted-foreground">Note: {invoice.note}</p>}
    </div>
  )
}

function PastDueNotice() {
  return (
    <div
      className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm"
      role="alert"
      data-testid="billing-past-due"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
      <p>
        An invoice is overdue. Paid features are paused and products that haven&apos;t taken a live payment yet can&apos;t start. Products already live keep
        working. Pay it below to put everything back.
      </p>
    </div>
  )
}

function PaymentMethod({ data }: { data: BillingSummary }) {
  const canManage = useCan("settings:write")
  const add = useCheckout(() => "/billing/card")
  const remove = useRemoveCard()
  const [confirmRemove, setConfirmRemove] = React.useState(false)
  const card = data.card
  return (
    <Panel data-testid="payment-method">
      <PanelHeader title="Payment method" description="Invoices are charged to this card when they're issued." />
      <div className="space-y-3 p-5 pt-3 text-sm">
        {!data.cardPayments ? (
          <p className="text-muted-foreground">Card payments are coming soon. Until then, reply to an invoice email and we&apos;ll send payment details.</p>
        ) : card ? (
          <>
            <div className="flex items-center gap-3 rounded-lg border px-3 py-2.5">
              <CreditCard className="size-5 text-muted-foreground" aria-hidden />
              <div className="min-w-0">
                <p className="font-medium capitalize">
                  {card.brand || "Card"} ending {card.last4}
                </p>
                <p className="text-xs text-muted-foreground">
                  Expires {card.expMonth}/{card.expYear}
                  {card.bank ? ` · ${card.bank}` : ""}
                </p>
              </div>
            </div>
            {canManage && (
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={add.isPending} onClick={() => add.mutate(undefined, { onError: (e) => toast.error(e.message) })}>
                  {add.isPending && <Loader2 className="animate-spin" />}
                  Use another card
                </Button>
                <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setConfirmRemove(true)}>
                  Remove
                </Button>
              </div>
            )}
          </>
        ) : canManage ? (
          <>
            <p className="text-muted-foreground">
              Add a card and invoices are paid automatically. Paystack checks it with a {data.billingCurrency === "NGN" ? "₦50" : "$1"} charge that is refunded
              straight away.
            </p>
            <Button size="sm" disabled={add.isPending} onClick={() => add.mutate(undefined, { onError: (e) => toast.error(e.message) })} data-testid="add-card">
              {add.isPending && <Loader2 className="animate-spin" />}
              Add a card
            </Button>
          </>
        ) : (
          <p className="text-muted-foreground">No card saved. An owner or admin can add one.</p>
        )}
      </div>
      <Dialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove this card?</DialogTitle>
            <DialogDescription>Invoices won&apos;t be charged automatically any more; you can pay each one by card from this page.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmRemove(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={async () => {
                try {
                  await remove.mutateAsync()
                  toast.success("Card removed")
                  setConfirmRemove(false)
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Could not remove the card")
                }
              }}
            >
              {remove.isPending && <Loader2 className="animate-spin" />}
              Remove card
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Panel>
  )
}

/** Shown across the dashboard (Cloud) while an invoice is overdue. */
export function BillingBanner() {
  const { data: entitlements } = useEntitlements()
  const { data } = useBilling({ enabled: entitlements?.edition === "cloud" })
  if (data?.billingStatus !== "past_due") return null
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-sm md:px-6" role="alert">
      <AlertTriangle className="size-4 shrink-0 text-destructive" aria-hidden />
      <span className="font-medium">A YaroPay invoice is overdue.</span>
      <span className="text-muted-foreground">Paid features are paused and new products can&apos;t go live. Payments already flowing keep working.</span>
      <Link href="/settings?tab=billing" className="ml-auto font-medium underline underline-offset-2">
        Pay now
      </Link>
    </div>
  )
}

/** Paystack sends the browser back here after checkout (it adds ?reference=...). */
export function BillingReturn({ reference }: { reference: string }) {
  const qc = useQueryClient()
  const confirm = useMutation({ mutationFn: () => api<CheckoutResult>("/billing/checkout/confirm", { method: "POST", json: { reference } }) })
  const started = React.useRef(false)
  const { mutate } = confirm
  React.useEffect(() => {
    if (started.current || !reference) return
    started.current = true
    mutate(undefined, { onSettled: () => qc.invalidateQueries({ queryKey: ["billing"] }) })
  }, [reference, mutate, qc])

  const result = confirm.data
  const title = !reference
    ? "Nothing to confirm"
    : confirm.isPending || !result
      ? confirm.isError
        ? "Couldn't confirm the payment"
        : "Confirming with Paystack…"
      : result.status === "success"
        ? result.purpose === "card_check"
          ? "Card saved"
          : "Invoice paid"
        : result.status === "pending"
          ? "Paystack hasn't finished yet"
          : "The payment didn't go through"
  const text =
    result?.status === "success"
      ? result.purpose === "card_check"
        ? "Future invoices will be charged to this card. The small check charge is being refunded."
        : "Thanks. A receipt is on its way to your inbox."
      : result?.status === "pending"
        ? "If you finished paying, give it a minute and check Billing again."
        : result?.status === "failed"
          ? (result.message ?? "Paystack declined it. Try again, or use another card.")
          : confirm.isError
            ? confirm.error.message
            : null
  return (
    <Panel className="mx-auto mt-10 max-w-md space-y-3 p-6 text-center" data-testid="billing-return">
      {confirm.isPending && <Loader2 className="mx-auto size-6 animate-spin text-muted-foreground" aria-hidden />}
      <h1 className="text-base font-semibold">{title}</h1>
      {text && <p className="text-sm text-muted-foreground">{text}</p>}
      <Button asChild size="sm">
        <Link href="/settings?tab=billing">Back to Billing</Link>
      </Button>
    </Panel>
  )
}
