"use client"

// YaroPay Enterprise License: see LICENSE.md in the parent folder.

import { type BillingPlan, type PriceEffective, type PriceSchedule, type PriceVersion } from "@yaropay/core/billing"
import { type Feature, FEATURE_INFO, FEATURES } from "@yaropay/core/editions"
import { formatMoney } from "@yaropay/core/money"
import type { PlatformRates } from "@yaropay/core/platform"
import { Loader2, Plus } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"
import { Panel, PanelHeader } from "@/components/shared/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { formatDate, formatRelative } from "@/lib/format"
import { useAddPrice, useCreatePlan, usePlans, usePlatformSettings, useRates, useSetRates, useUpdatePlan, useUpdatePlatformSettings } from "./hooks"
import { isCancelled, PlatformShell, useGuarded } from "./platform-shell"

export function PricingPage() {
  const [creating, setCreating] = React.useState(false)
  return (
    <PlatformShell
      title="Plans & pricing"
      description="What YaroPay Cloud charges. Every number here is yours to change; a price change applies from the start of a month, so past bills keep their price."
      actions={
        <Button size="sm" onClick={() => setCreating(true)} data-testid="new-plan">
          <Plus /> New plan
        </Button>
      }
    >
      <Signups />
      <Plans />
      <Rates />
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">{creating && <NewPlanForm onDone={() => setCreating(false)} />}</DialogContent>
      </Dialog>
    </PlatformShell>
  )
}

function describeSchedule(s: PriceSchedule) {
  const per = `${formatMoney(s.perLiveProduct.NGN, "NGN", { decimals: false })} / ${formatMoney(s.perLiveProduct.USD, "USD")} per live product`
  if (!s.volumeFee.enabled || s.volumeFee.rateBps === 0) return { per, volume: "No volume fee" }
  const pct = (s.volumeFee.rateBps / 100).toLocaleString("en", { maximumFractionDigits: 2 })
  const cap = s.volumeFee.cap ? `, at most ${formatMoney(s.volumeFee.cap.NGN, "NGN", { decimals: false })} / ${formatMoney(s.volumeFee.cap.USD, "USD")} a month` : ""
  return {
    per,
    volume: `${pct}% of live volume above ${formatMoney(s.volumeFee.threshold.NGN, "NGN", { decimals: false })} / ${formatMoney(s.volumeFee.threshold.USD, "USD", { decimals: false })} a month${cap}`,
  }
}

function PriceSummary({ version, label }: { version: PriceVersion; label?: string }) {
  const d = describeSchedule(version.schedule)
  return (
    <div className="space-y-0.5 text-sm">
      {label && <p className="text-xs font-medium text-muted-foreground">{label}</p>}
      <p className="font-medium">{d.per}</p>
      <p className="text-muted-foreground">{d.volume}</p>
    </div>
  )
}

function Plans() {
  const { data, isLoading } = usePlans()
  if (isLoading || !data) return <Skeleton className="h-40 rounded-2xl" />
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {data.map((p) => (
        <PlanCard key={p.id} plan={p} />
      ))}
    </div>
  )
}

function PlanCard({ plan }: { plan: BillingPlan }) {
  const [dialog, setDialog] = React.useState<"price" | "edit" | null>(null)
  return (
    <Panel className={plan.active ? undefined : "opacity-70"} data-testid={`plan-${plan.slug}`}>
      <PanelHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {plan.name}
            <Badge variant={plan.public ? "secondary" : "outline"}>{plan.public ? "Public" : "Private"}</Badge>
            {!plan.active && <Badge variant="outline">Retired</Badge>}
          </span>
        }
        description={`${plan.slug} · ${plan.trialDays}-day trial · ${plan.workspaces} compan${plan.workspaces === 1 ? "y" : "ies"}`}
      />
      <div className="space-y-4 p-5 pt-3">
        {plan.description && <p className="text-sm text-muted-foreground">{plan.description}</p>}
        <PriceSummary version={plan.price} label="This month" />
        {plan.nextPrice && <PriceSummary version={plan.nextPrice} label={`From ${formatDate(plan.nextPrice.effectiveFrom)}`} />}
        <p className="text-xs text-muted-foreground">
          {plan.features.length === FEATURES.length ? "All paid features" : plan.features.length ? plan.features.map((f) => FEATURE_INFO[f]?.label ?? f).join(", ") : "No paid features"}
        </p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setDialog("price")} data-testid={`change-price-${plan.slug}`}>
            Change price
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setDialog("edit")}>
            Edit plan
          </Button>
        </div>
      </div>
      <Dialog open={dialog !== null} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          {dialog === "price" && <ChangePrice plan={plan} onDone={() => setDialog(null)} />}
          {dialog === "edit" && <EditPlan plan={plan} onDone={() => setDialog(null)} />}
        </DialogContent>
      </Dialog>
    </Panel>
  )
}

// ---- Price editor: major units on screen, minor units on the wire ----

interface PriceDraft {
  perNGN: string
  perUSD: string
  volumeOn: boolean
  ratePct: string
  thresholdNGN: string
  thresholdUSD: string
  capOn: boolean
  capNGN: string
  capUSD: string
}

const major = (minor: number) => String(minor / 100)
const toMinor = (v: string) => Math.round(Number(v || "0") * 100)

function draftOf(s: PriceSchedule): PriceDraft {
  return {
    perNGN: major(s.perLiveProduct.NGN),
    perUSD: major(s.perLiveProduct.USD),
    volumeOn: s.volumeFee.enabled,
    ratePct: String(s.volumeFee.rateBps / 100),
    thresholdNGN: major(s.volumeFee.threshold.NGN),
    thresholdUSD: major(s.volumeFee.threshold.USD),
    capOn: s.volumeFee.cap !== null,
    capNGN: major(s.volumeFee.cap?.NGN ?? 0),
    capUSD: major(s.volumeFee.cap?.USD ?? 0),
  }
}

function scheduleOf(d: PriceDraft): PriceSchedule {
  return {
    perLiveProduct: { NGN: toMinor(d.perNGN), USD: toMinor(d.perUSD) },
    volumeFee: {
      enabled: d.volumeOn,
      rateBps: Math.round(Number(d.ratePct || "0") * 100),
      threshold: { NGN: toMinor(d.thresholdNGN), USD: toMinor(d.thresholdUSD) },
      cap: d.capOn ? { NGN: toMinor(d.capNGN), USD: toMinor(d.capUSD) } : null,
    },
  }
}

function invalidDraft(d: PriceDraft): string | null {
  const nums = [d.perNGN, d.perUSD, d.thresholdNGN, d.thresholdUSD, d.capNGN, d.capUSD, d.ratePct]
  if (nums.some((v) => v !== "" && (!Number.isFinite(Number(v)) || Number(v) < 0))) return "Amounts must be zero or more"
  if (Number(d.ratePct) > 100) return "The volume fee can be at most 100%"
  return null
}

function MoneyInput({ id, label, symbol, value, onChange, testId }: { id: string; label: string; symbol: string; value: string; onChange: (v: string) => void; testId?: string }) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <div className="flex items-center rounded-lg border bg-background focus-within:ring-2 focus-within:ring-ring">
        <span className="pl-3 text-sm text-muted-foreground">{symbol}</span>
        <Input id={id} inputMode="decimal" className="border-0 shadow-none focus-visible:ring-0" value={value} onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ""))} data-testid={testId} />
      </div>
    </Field>
  )
}

function PriceEditor({ draft, onChange }: { draft: PriceDraft; onChange: (d: PriceDraft) => void }) {
  const set = (patch: Partial<PriceDraft>) => onChange({ ...draft, ...patch })
  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 text-sm font-medium">Per live product, each month</p>
        <div className="grid grid-cols-2 gap-3">
          <MoneyInput id="per-ngn" label="Naira" symbol="₦" value={draft.perNGN} onChange={(v) => set({ perNGN: v })} testId="price-per-ngn" />
          <MoneyInput id="per-usd" label="US dollars" symbol="$" value={draft.perUSD} onChange={(v) => set({ perUSD: v })} testId="price-per-usd" />
        </div>
      </div>
      <div className="space-y-3 rounded-lg border p-3">
        <label className="flex items-center justify-between gap-3 text-sm font-medium">
          Percentage of live volume
          <Switch checked={draft.volumeOn} onCheckedChange={(v) => set({ volumeOn: v })} data-testid="volume-fee-on" />
        </label>
        {draft.volumeOn && (
          <>
            <Field>
              <FieldLabel htmlFor="rate-pct">Rate</FieldLabel>
              <div className="flex items-center rounded-lg border bg-background focus-within:ring-2 focus-within:ring-ring">
                <Input id="rate-pct" inputMode="decimal" className="border-0 shadow-none focus-visible:ring-0" value={draft.ratePct} onChange={(e) => set({ ratePct: e.target.value.replace(/[^\d.]/g, "") })} data-testid="volume-rate" />
                <span className="pr-3 text-sm text-muted-foreground">%</span>
              </div>
              <FieldDescription>Charged only on the volume above the threshold below.</FieldDescription>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <MoneyInput id="threshold-ngn" label="Free each month (₦)" symbol="₦" value={draft.thresholdNGN} onChange={(v) => set({ thresholdNGN: v })} testId="volume-threshold-ngn" />
              <MoneyInput id="threshold-usd" label="Free each month ($)" symbol="$" value={draft.thresholdUSD} onChange={(v) => set({ thresholdUSD: v })} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={draft.capOn} onCheckedChange={(v) => set({ capOn: v === true })} />
              Cap the volume fee each month
            </label>
            {draft.capOn && (
              <div className="grid grid-cols-2 gap-3">
                <MoneyInput id="cap-ngn" label="Most per month (₦)" symbol="₦" value={draft.capNGN} onChange={(v) => set({ capNGN: v })} />
                <MoneyInput id="cap-usd" label="Most per month ($)" symbol="$" value={draft.capUSD} onChange={(v) => set({ capUSD: v })} />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function ChangePrice({ plan, onDone }: { plan: BillingPlan; onDone: () => void }) {
  const guarded = useGuarded()
  const add = useAddPrice(plan.id)
  const [draft, setDraft] = React.useState(() => draftOf((plan.nextPrice ?? plan.price).schedule))
  const [effective, setEffective] = React.useState<PriceEffective>("next_month")
  const problem = invalidDraft(draft)
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault()
        try {
          await guarded(() => add.mutateAsync({ schedule: scheduleOf(draft), effective }))
          toast.success(effective === "next_month" ? "New price starts next month" : "New price applies to this month")
          onDone()
        } catch (err) {
          if (!isCancelled(err)) toast.error(err instanceof Error ? err.message : "Could not save the price")
        }
      }}
      className="space-y-5"
    >
      <DialogHeader>
        <DialogTitle>Change the {plan.name} price</DialogTitle>
        <DialogDescription>Applies to every company on this plan from the start of the month you pick. Past months keep their price.</DialogDescription>
      </DialogHeader>
      <PriceEditor draft={draft} onChange={setDraft} />
      <RadioGroup value={effective} onValueChange={(v) => setEffective(v as PriceEffective)} className="gap-2">
        <label className="flex items-start gap-2 text-sm">
          <RadioGroupItem value="next_month" className="mt-0.5" />
          <span>
            <span className="font-medium">From next month</span>
            <span className="block text-muted-foreground">Companies see it coming before it applies.</span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <RadioGroupItem value="this_month" className="mt-0.5" data-testid="effective-this-month" />
          <span>
            <span className="font-medium">From this month</span>
            <span className="block text-muted-foreground">Changes the bill for the month in progress, which hasn&apos;t been sent yet.</span>
          </span>
        </label>
      </RadioGroup>
      {problem && <p className="text-sm text-destructive">{problem}</p>}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={add.isPending || problem !== null} data-testid="save-price">
          {add.isPending && <Loader2 className="animate-spin" />}
          Save price
        </Button>
      </DialogFooter>
    </form>
  )
}

function FeaturePicker({ value, onChange }: { value: Feature[]; onChange: (f: Feature[]) => void }) {
  return (
    <fieldset className="space-y-2">
      <legend className="mb-1 text-sm font-medium">Paid features</legend>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {FEATURES.map((f) => (
          <label key={f} className="flex items-center gap-2 text-sm">
            <Checkbox checked={value.includes(f)} onCheckedChange={(on) => onChange(on === true ? [...value, f] : value.filter((x) => x !== f))} />
            {FEATURE_INFO[f].label}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

function EditPlan({ plan, onDone }: { plan: BillingPlan; onDone: () => void }) {
  const guarded = useGuarded()
  const update = useUpdatePlan(plan.id)
  const [name, setName] = React.useState(plan.name)
  const [description, setDescription] = React.useState(plan.description)
  const [isPublic, setPublic] = React.useState(plan.public)
  const [trialDays, setTrialDays] = React.useState(String(plan.trialDays))
  const [features, setFeatures] = React.useState<Feature[]>(plan.features)
  const [active, setActive] = React.useState(plan.active)
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault()
        try {
          await guarded(() => update.mutateAsync({ name, description, public: isPublic, trialDays: Number(trialDays), features, active }))
          toast.success("Plan saved")
          onDone()
        } catch (err) {
          if (!isCancelled(err)) toast.error(err instanceof Error ? err.message : "Could not save the plan")
        }
      }}
      className="space-y-4"
    >
      <DialogHeader>
        <DialogTitle>Edit {plan.name}</DialogTitle>
        <DialogDescription>Feature changes apply to companies on this plan right away.</DialogDescription>
      </DialogHeader>
      <Field>
        <FieldLabel htmlFor="plan-name">Name</FieldLabel>
        <Input id="plan-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
      </Field>
      <Field>
        <FieldLabel htmlFor="plan-description">Description</FieldLabel>
        <Input id="plan-description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} />
      </Field>
      <Field>
        <FieldLabel htmlFor="plan-trial">Trial days</FieldLabel>
        <Input id="plan-trial" inputMode="numeric" value={trialDays} onChange={(e) => setTrialDays(e.target.value.replace(/\D/g, ""))} />
      </Field>
      <FeaturePicker value={features} onChange={setFeatures} />
      <label className="flex items-center justify-between gap-3 text-sm">
        <span>
          <span className="font-medium">Public</span>
          <span className="block text-muted-foreground">Offered at sign-up. Private plans are for custom deals.</span>
        </span>
        <Switch checked={isPublic} onCheckedChange={setPublic} />
      </label>
      <label className="flex items-center justify-between gap-3 text-sm">
        <span>
          <span className="font-medium">Active</span>
          <span className="block text-muted-foreground">Retired plans can&apos;t be given to more companies; ones already on it keep it.</span>
        </span>
        <Switch checked={active} onCheckedChange={setActive} />
      </label>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={update.isPending || name.trim().length < 2}>
          {update.isPending && <Loader2 className="animate-spin" />}
          Save plan
        </Button>
      </DialogFooter>
    </form>
  )
}

function NewPlanForm({ onDone }: { onDone: () => void }) {
  const guarded = useGuarded()
  const create = useCreatePlan()
  const [slug, setSlug] = React.useState("")
  const [name, setName] = React.useState("")
  const [description, setDescription] = React.useState("")
  const [isPublic, setPublic] = React.useState(false)
  const [trialDays, setTrialDays] = React.useState("14")
  const [features, setFeatures] = React.useState<Feature[]>([...FEATURES])
  const [draft, setDraft] = React.useState<PriceDraft>(() =>
    draftOf({ perLiveProduct: { NGN: 1_500_000, USD: 1_000 }, volumeFee: { enabled: false, rateBps: 0, threshold: { NGN: 0, USD: 0 }, cap: null } }),
  )
  const problem = invalidDraft(draft)
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault()
        try {
          await guarded(() => create.mutateAsync({ slug, name, description, public: isPublic, trialDays: Number(trialDays), features, schedule: scheduleOf(draft) }))
          toast.success(`${name} plan created`)
          onDone()
        } catch (err) {
          if (!isCancelled(err)) toast.error(err instanceof Error ? err.message : "Could not create the plan")
        }
      }}
      className="space-y-4"
    >
      <DialogHeader>
        <DialogTitle>New plan</DialogTitle>
        <DialogDescription>For a new public tier, or a private deal for one company. Its price applies straight away.</DialogDescription>
      </DialogHeader>
      <div className="grid grid-cols-2 gap-3">
        <Field>
          <FieldLabel htmlFor="new-plan-name">Name</FieldLabel>
          <Input
            id="new-plan-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              if (!slug || slug === slugify(name)) setSlug(slugify(e.target.value))
            }}
            maxLength={40}
            data-testid="new-plan-name"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="new-plan-slug">Short name</FieldLabel>
          <Input id="new-plan-slug" value={slug} onChange={(e) => setSlug(slugify(e.target.value))} maxLength={31} className="font-mono" />
        </Field>
      </div>
      <Field>
        <FieldLabel htmlFor="new-plan-description">Description</FieldLabel>
        <Input id="new-plan-description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} />
      </Field>
      <Field>
        <FieldLabel htmlFor="new-plan-trial">Trial days</FieldLabel>
        <Input id="new-plan-trial" inputMode="numeric" value={trialDays} onChange={(e) => setTrialDays(e.target.value.replace(/\D/g, ""))} />
      </Field>
      <PriceEditor draft={draft} onChange={setDraft} />
      <FeaturePicker value={features} onChange={setFeatures} />
      <label className="flex items-center justify-between gap-3 text-sm">
        <span className="font-medium">Public (offered at sign-up)</span>
        <Switch checked={isPublic} onCheckedChange={setPublic} />
      </label>
      {problem && <p className="text-sm text-destructive">{problem}</p>}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={create.isPending || problem !== null || name.trim().length < 2 || slug.length < 2} data-testid="create-plan">
          {create.isPending && <Loader2 className="animate-spin" />}
          Create plan
        </Button>
      </DialogFooter>
    </form>
  )
}

const slugify = (v: string) =>
  v
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 31)

const RATE_CURRENCIES = [
  { code: "USD", name: "US dollar" },
  { code: "GHS", name: "Ghanaian cedi" },
  { code: "KES", name: "Kenyan shilling" },
  { code: "ZAR", name: "South African rand" },
] as const

function Rates() {
  const { data } = useRates()
  if (!data) return <Skeleton className="h-40 rounded-2xl" />
  // Remounts (fresh fields) whenever the saved rates change.
  return <RatesForm key={JSON.stringify(data.rates)} data={data} />
}

function RatesForm({ data }: { data: PlatformRates }) {
  const guarded = useGuarded()
  const save = useSetRates()
  const [values, setValues] = React.useState<Record<string, string>>(() => ({ ...data.rates }) as Record<string, string>)
  const updated = data.rows.reduce<string | null>((latest, r) => (!latest || r.updatedAt > latest ? r.updatedAt : latest), null)
  return (
    <Panel>
      <PanelHeader
        title="Exchange rates"
        description={`Naira for one unit of each currency. Used to add up volume in other currencies for volume fees and to bill companies in dollars.${updated ? ` Last changed ${formatRelative(updated)}.` : ""}`}
      />
      <form
        className="grid gap-4 p-5 pt-3 sm:grid-cols-2 lg:grid-cols-4"
        onSubmit={async (e) => {
          e.preventDefault()
          try {
            await guarded(() => save.mutateAsync(Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim()))))
            toast.success("Exchange rates saved")
          } catch (err) {
            if (!isCancelled(err)) toast.error(err instanceof Error ? err.message : "Could not save the rates")
          }
        }}
      >
        {RATE_CURRENCIES.map((c) => (
          <Field key={c.code}>
            <FieldLabel htmlFor={`rate-${c.code}`}>1 {c.code} =</FieldLabel>
            <div className="flex items-center rounded-lg border bg-background focus-within:ring-2 focus-within:ring-ring">
              <span className="pl-3 text-sm text-muted-foreground">₦</span>
              <Input
                id={`rate-${c.code}`}
                inputMode="decimal"
                placeholder="Not set"
                className="border-0 shadow-none focus-visible:ring-0"
                value={values[c.code] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [c.code]: e.target.value.replace(/[^\d.]/g, "") }))}
                data-testid={`rate-${c.code}`}
              />
            </div>
            <FieldDescription>{c.name}</FieldDescription>
          </Field>
        ))}
        <div className="sm:col-span-2 lg:col-span-4">
          <Button type="submit" size="sm" disabled={save.isPending} data-testid="save-rates">
            {save.isPending && <Loader2 className="animate-spin" />}
            Save rates
          </Button>
        </div>
      </form>
    </Panel>
  )
}

/** Whether anyone can create a company, and which plan they start on. */
function Signups() {
  const { data } = usePlatformSettings()
  const { data: plans } = usePlans()
  const guarded = useGuarded()
  const update = useUpdatePlatformSettings()
  if (!data) return <Skeleton className="h-24 rounded-2xl" />
  const save = async (input: { signupsOpen?: boolean; signupPlan?: string }, done: string) => {
    try {
      await guarded(() => update.mutateAsync(input))
      toast.success(done)
    } catch (e) {
      if (!isCancelled(e)) toast.error(e instanceof Error ? e.message : "Could not save")
    }
  }
  return (
    <Panel data-testid="signups-panel">
      <PanelHeader
        title="Sign-ups"
        description="New companies sign up at /signup, confirm their email, and use test mode free. Their trial starts with their first live payment."
        actions={<Badge variant={data.signupsOpen ? "default" : "outline"}>{data.signupsOpen ? "Open" : "Closed"}</Badge>}
      />
      <div className="flex flex-col gap-4 p-5 pt-3 sm:flex-row sm:items-end">
        <label className="flex flex-1 items-center justify-between gap-3 text-sm">
          <span>
            <span className="font-medium">Let anyone sign up</span>
            <span className="block text-muted-foreground">Closed, the sign-up page says so and the sign-in page doesn&apos;t link to it.</span>
          </span>
          <Switch
            checked={data.signupsOpen}
            disabled={update.isPending}
            onCheckedChange={(open) => void save({ signupsOpen: open }, open ? "Sign-ups are open" : "Sign-ups are closed")}
            data-testid="signups-open"
          />
        </label>
        <Field className="sm:w-56">
          <FieldLabel>New companies start on</FieldLabel>
          <Select value={data.signupPlan} onValueChange={(slug) => void save({ signupPlan: slug }, "Sign-up plan saved")}>
            <SelectTrigger aria-label="Sign-up plan">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(plans ?? [])
                .filter((p) => p.active || p.slug === data.signupPlan)
                .map((p) => (
                  <SelectItem key={p.id} value={p.slug}>
                    {p.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
    </Panel>
  )
}
