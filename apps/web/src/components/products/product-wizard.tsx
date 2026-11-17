"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import {
  AlertTriangle,
  AppWindow,
  ArrowLeft,
  ArrowRight,
  Check,
  Globe,
  Loader2,
  Plus,
  ShoppingBag,
  Smartphone,
  Sparkles,
} from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import * as React from "react"
import { Controller, useForm, useWatch } from "react-hook-form"
import { InstallDialog } from "@/components/apps/install-dialog"
import { GatewayMark } from "@/components/shared/gateway-mark"
import { PageHeader, Panel } from "@/components/shared/page-header"
import { ProductAvatar } from "@/components/shared/product-chip"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import type { CreatedProduct } from "@yaropay/core/api"
import { installableGateways, requireGateway } from "@yaropay/core/gateways/registry"
import { BetaBadge } from "@/components/shared/beta-badge"
import { makeReference, suggestPrefix } from "@yaropay/core/routing"
import { type ProductInput, productInputSchema } from "@yaropay/core/schemas"
import type { GatewayConnection } from "@yaropay/core/types"
import { isHttpsUrl } from "@yaropay/core/urls"
import { ApiRequestError } from "@/lib/api/client"
import { useConnections, useCreateProduct, useProducts, useSettings } from "@/lib/api/hooks"
import { useCan, useHasAllProducts } from "@/lib/auth"
import { COLOR_SLOTS, nextFreeSlot, seriesVar } from "@/lib/colors"
import { KIND_LABELS } from "@/lib/format"
import { cn } from "@/lib/utils"
import { IntegrationPanel } from "./integration-panel"

const STEPS = [
  { id: "details", title: "Details", description: "Name, website and colour" },
  { id: "gateways", title: "Payment gateways", description: "Which accounts take payments" },
  { id: "urls", title: "Your URLs", description: "Where customers and events go" },
  { id: "review", title: "Review", description: "Check and create" },
] as const

const STEP_FIELDS: (keyof ProductInput)[][] = [
  ["name", "kind", "websiteUrl", "colorSlot", "referencePrefix"],
  ["gateways"],
  ["webhookUrl", "successUrl", "failureUrl", "cancelUrl"],
  [],
]

const KINDS = [
  { value: "website", icon: ShoppingBag },
  { value: "saas", icon: AppWindow },
  { value: "mobile", icon: Smartphone },
  { value: "other", icon: Globe },
] as const

export function ProductWizard() {
  const router = useRouter()
  const { data: products } = useProducts()
  const { data: connections = [] } = useConnections()
  const { data: settings } = useSettings()
  const create = useCreateProduct()
  const [step, setStep] = React.useState(0)
  const [created, setCreated] = React.useState<CreatedProduct | null>(null)
  const [installing, setInstalling] = React.useState<string | null>(null)
  const [prefixTouched, setPrefixTouched] = React.useState(false)
  const canWriteProducts = useCan("products:write")
  const allProducts = useHasAllProducts()
  const canInstall = useCan("gateways:write")

  const form = useForm<ProductInput>({
    resolver: zodResolver(productInputSchema),
    mode: "onTouched",
    defaultValues: {
      name: "",
      kind: "website",
      websiteUrl: "",
      colorSlot: 1,
      referencePrefix: "",
      gateways: [],
      webhookUrl: "",
      successUrl: "",
      failureUrl: "",
      cancelUrl: "",
    },
  })
  const { register, control, formState, setValue, getValues } = form
  const values = useWatch({ control })
  const errors = formState.errors

  const usedSlots = React.useMemo(() => products?.map((p) => p.colorSlot) ?? [], [products])
  const takenPrefixes = React.useMemo(() => products?.map((p) => p.referencePrefix) ?? [], [products])

  // Pick the first free colour once products load.
  React.useEffect(() => {
    if (products && !formState.dirtyFields.colorSlot) setValue("colorSlot", nextFreeSlot(usedSlots))
  }, [products, usedSlots, setValue, formState.dirtyFields.colorSlot])

  const attached = values.gateways ?? []
  const attachedConns = attached
    .map((g) => connections.find((c) => c.id === g.connectionId))
    .filter((c): c is GatewayConnection => !!c)
  const anyLive = attachedConns.some((c) => c.mode === "live")
  const attachedGatewayDefs = [...new Set(attachedConns.map((c) => c.gatewayId))].map(requireGateway)
  const cancelSupported = attachedGatewayDefs.some((g) => g.redirects.cancel || g.redirects.statusParam)

  const toggleConnection = (connectionId: string, on: boolean) => {
    const current = getValues("gateways")
    let next = on ? [...current, { connectionId, isDefault: current.length === 0 }] : current.filter((g) => g.connectionId !== connectionId)
    if (next.length && !next.some((g) => g.isDefault)) next = next.map((g, i) => ({ ...g, isDefault: i === 0 }))
    setValue("gateways", next, { shouldValidate: formState.isSubmitted || !!errors.gateways, shouldDirty: true })
  }
  const makeDefault = (connectionId: string) => {
    setValue(
      "gateways",
      getValues("gateways").map((g) => ({ ...g, isDefault: g.connectionId === connectionId })),
      { shouldDirty: true },
    )
  }

  const next = async () => {
    const fields = STEP_FIELDS[step]
    const ok = fields.length ? await form.trigger(fields) : true
    if (!ok) return
    if (step === 2 && anyLive && values.webhookUrl && !isHttpsUrl(values.webhookUrl)) {
      form.setError("webhookUrl", { message: "Live payments need an https:// webhook URL" })
      return
    }
    setStep((s) => Math.min(s + 1, STEPS.length - 1))
  }

  const submit = form.handleSubmit(async (input) => {
    try {
      const res = await create.mutateAsync({ ...input, cancelUrl: cancelSupported ? input.cancelUrl : "" })
      setCreated(res)
    } catch (e) {
      if (e instanceof ApiRequestError && e.fields) {
        let firstStep = STEPS.length - 1
        for (const [key, message] of Object.entries(e.fields)) {
          form.setError(key as keyof ProductInput, { message })
          const idx = STEP_FIELDS.findIndex((f) => f.includes(key as keyof ProductInput))
          if (idx >= 0) firstStep = Math.min(firstStep, idx)
        }
        setStep(firstStep)
      } else {
        form.setError("root", { message: e instanceof Error ? e.message : "Could not create the product" })
      }
    }
  })

  if (!canWriteProducts || !allProducts) {
    return (
      <Panel className="mx-auto max-w-lg p-8 text-center">
        <p className="font-medium">You can&apos;t create products</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {canWriteProducts
            ? "Your access is limited to specific products. Ask an owner or admin to create the product and add you to it."
            : "Your role can view products but not change them. Ask an owner, admin or developer."}
        </p>
        <Button variant="outline" size="sm" asChild className="mt-4">
          <Link href="/products">Back to products</Link>
        </Button>
      </Panel>
    )
  }

  if (created && settings) {
    return (
      <div className="space-y-6">
        <PageHeader
          title={
            <span className="flex items-center gap-3">
              <ProductAvatar name={created.product.name} slot={created.product.colorSlot} />
              {created.product.name} is ready
            </span>
          }
          description="Copy the API keys and signing secret now: they are not shown again. The callback URLs below are what your product uses with each gateway."
          actions={
            <>
              <Button variant="outline" onClick={() => window.location.reload()}>
                <Plus /> Create another
              </Button>
              <Button onClick={() => router.push(`/products/${created.product.id}`)} data-testid="open-product">
                Open {created.product.name} <ArrowRight />
              </Button>
            </>
          }
        />
        <div className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning-text" />
          <p>
            <span className="font-medium">Store these secrets in your product&apos;s server environment</span>{" "}
            <span className="text-muted-foreground">
              (for example YAROPAY_API_KEY and YAROPAY_SIGNING_SECRET). Use the test key with sandbox gateway accounts and the live key in production. You can rotate them later from the product&apos;s settings.
            </span>
          </p>
        </div>
        <IntegrationPanel
          product={created.product}
          baseUrl={settings.baseUrl}
          connections={connections}
          secrets={{ apiKey: created.apiKey, testApiKey: created.testApiKey, signingSecret: created.signingSecret }}
        />
      </div>
    )
  }

  // Sample accounts hold fake keys and leave with the sample data, so new products can't use them.
  const installedByGateway = (gid: string) => connections.filter((c) => c.gatewayId === gid && !c.sample)

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild className="-ml-2 text-muted-foreground">
        <Link href="/products">
          <ArrowLeft /> Products
        </Link>
      </Button>
      <PageHeader
        title="New product"
        description="A product is one website or app that takes payments. It gets its own callback URLs, API key and webhook, while sharing your installed gateway accounts."
      />

      <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
        <ol className="flex gap-2 overflow-x-auto lg:flex-col lg:gap-1" aria-label="Steps">
          {STEPS.map((s, i) => {
            const done = i < step
            const current = i === step
            return (
              <li key={s.id} className="shrink-0">
                <button
                  type="button"
                  disabled={i > step}
                  onClick={() => i < step && setStep(i)}
                  aria-current={current ? "step" : undefined}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors",
                    current ? "bg-card shadow-card ring-1 ring-border" : "hover:bg-muted/60 disabled:hover:bg-transparent",
                  )}
                >
                  <span
                    className={cn(
                      "grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold",
                      done ? "bg-primary text-primary-foreground" : current ? "bg-foreground text-background" : "bg-muted text-muted-foreground",
                    )}
                  >
                    {done ? <Check className="size-3.5" /> : i + 1}
                  </span>
                  <span className="min-w-0">
                    <span className={cn("block text-sm font-medium", !current && !done && "text-muted-foreground")}>{s.title}</span>
                    <span className="hidden text-xs text-muted-foreground lg:block">{s.description}</span>
                  </span>
                </button>
              </li>
            )
          })}
        </ol>

        <Panel className="min-w-0 p-5 md:p-6">
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (step < STEPS.length - 1) next()
              else submit()
            }}
            noValidate
          >
            {step === 0 && (
              <FieldGroup className="gap-5">
                <div className="grid gap-5 md:grid-cols-2">
                  <Field data-invalid={!!errors.name}>
                    <FieldLabel htmlFor="name">Product name</FieldLabel>
                    <Input
                      id="name"
                      placeholder="e.g. Product B"
                      autoFocus
                      {...register("name", {
                        onChange: (e) => {
                          if (!prefixTouched) {
                            setValue("referencePrefix", e.target.value.trim() ? suggestPrefix(e.target.value, takenPrefixes) : "")
                          }
                        },
                      })}
                    />
                    <FieldError errors={[errors.name]} />
                  </Field>
                  <Field data-invalid={!!errors.websiteUrl}>
                    <FieldLabel htmlFor="websiteUrl">Website or app URL</FieldLabel>
                    <Input id="websiteUrl" placeholder="https://product-b.com" inputMode="url" {...register("websiteUrl")} />
                    <FieldError errors={[errors.websiteUrl]} />
                  </Field>
                </div>

                <Field>
                  <FieldLabel>Type</FieldLabel>
                  <Controller
                    control={control}
                    name="kind"
                    render={({ field }) => (
                      <div role="radiogroup" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        {KINDS.map(({ value, icon: Icon }) => (
                          <button
                            key={value}
                            type="button"
                            role="radio"
                            aria-checked={field.value === value}
                            onClick={() => field.onChange(value)}
                            className={cn(
                              "flex items-center gap-2 rounded-xl border p-3 text-left text-sm transition-colors",
                              field.value === value ? "border-primary bg-accent/60 ring-1 ring-primary" : "hover:bg-muted/50",
                            )}
                          >
                            <Icon className="size-4 text-muted-foreground" />
                            {KIND_LABELS[value]}
                          </button>
                        ))}
                      </div>
                    )}
                  />
                </Field>

                <div className="grid gap-5 md:grid-cols-2">
                  <Field>
                    <FieldLabel>Colour</FieldLabel>
                    <Controller
                      control={control}
                      name="colorSlot"
                      render={({ field }) => (
                        <div role="radiogroup" aria-label="Product colour" className="flex flex-wrap gap-2">
                          {COLOR_SLOTS.map((slot) => {
                            const owner = products?.find((p) => p.colorSlot === slot)
                            return (
                              <button
                                key={slot}
                                type="button"
                                role="radio"
                                aria-checked={field.value === slot}
                                aria-label={owner ? `Colour ${slot}, used by ${owner.name}` : `Colour ${slot}`}
                                title={owner ? `Used by ${owner.name}` : undefined}
                                onClick={() => field.onChange(slot)}
                                className={cn(
                                  "relative grid size-8 place-items-center rounded-full ring-offset-2 ring-offset-card transition",
                                  field.value === slot && "ring-2 ring-foreground",
                                  owner && field.value !== slot && "opacity-40",
                                )}
                                style={{ backgroundColor: seriesVar(slot) }}
                              >
                                {field.value === slot && <Check className="size-4 text-white" />}
                              </button>
                            )
                          })}
                        </div>
                      )}
                    />
                    <FieldDescription>Used for this product in every chart and table. Faded colours are taken.</FieldDescription>
                  </Field>
                  <Field data-invalid={!!errors.referencePrefix}>
                    <FieldLabel htmlFor="referencePrefix">Reference prefix</FieldLabel>
                    <Input
                      id="referencePrefix"
                      className="font-mono uppercase"
                      maxLength={6}
                      placeholder="PRB"
                      {...register("referencePrefix", {
                        onChange: (e) => {
                          setPrefixTouched(true)
                          e.target.value = e.target.value.toUpperCase()
                        },
                      })}
                    />
                    {errors.referencePrefix ? (
                      <FieldError errors={[errors.referencePrefix]} />
                    ) : (
                      <FieldDescription>
                        Payments look like{" "}
                        <code className="font-mono text-foreground">{makeReference(values.referencePrefix || "PRB", seeded())}</code>. This is how
                        YaroPay tells this product&apos;s payments apart.
                      </FieldDescription>
                    )}
                  </Field>
                </div>
              </FieldGroup>
            )}

            {step === 1 && (
              <div className="space-y-5">
                <div>
                  <h2 className="font-semibold">Attach payment gateways</h2>
                  <p className="text-sm text-muted-foreground">
                    Pick the accounts this product can charge through. The default one is used unless your API call names another.
                  </p>
                </div>
                <div className="space-y-3">
                  {installableGateways.map((g) => {
                      const conns = installedByGateway(g.id)
                      return (
                        <div key={g.id} className="rounded-xl border">
                          <div className="flex items-center gap-3 p-3">
                            <GatewayMark gatewayId={g.id} />
                            <div className="min-w-0 flex-1">
                              <p className="flex items-center gap-1.5 text-sm font-medium">
                                {g.name}
                                {g.status === "beta" && <BetaBadge />}
                              </p>
                              <p className="truncate text-xs text-muted-foreground">{g.tagline}</p>
                            </div>
                            {conns.length > 0 ? (
                              canInstall ? (
                                <Button type="button" variant="ghost" size="sm" onClick={() => setInstalling(g.id)}>
                                  <Plus /> Add account
                                </Button>
                              ) : null
                            ) : (
                              <Badge variant="outline">Not installed</Badge>
                            )}
                          </div>
                          {conns.length > 0 ? (
                            <ul className="divide-y border-t">
                              {conns.map((c) => {
                                const sel = attached.find((a) => a.connectionId === c.id)
                                return (
                                  <li key={c.id} className="flex items-center gap-3 px-3 py-2.5">
                                    <Checkbox
                                      id={`att-${c.id}`}
                                      checked={!!sel}
                                      onCheckedChange={(v) => toggleConnection(c.id, v === true)}
                                      data-testid={`attach-${c.id}`}
                                    />
                                    <label htmlFor={`att-${c.id}`} className="flex flex-1 cursor-pointer items-center gap-2 text-sm">
                                      <span className={cn("size-1.5 rounded-full", c.mode === "live" ? "bg-good" : "bg-warning")} aria-hidden />
                                      {c.label}
                                      <span className="text-xs text-muted-foreground capitalize">{c.mode}</span>
                                    </label>
                                    {sel &&
                                      (sel.isDefault ? (
                                        <Badge variant="secondary">Default</Badge>
                                      ) : (
                                        <Button type="button" variant="ghost" size="xs" onClick={() => makeDefault(c.id)}>
                                          Make default
                                        </Button>
                                      ))}
                                  </li>
                                )
                              })}
                            </ul>
                          ) : (
                            <div className="flex flex-col gap-3 border-t bg-muted/30 p-3 sm:flex-row sm:items-center">
                              <p className="flex-1 text-sm text-muted-foreground">
                                {canInstall
                                  ? `Install ${g.name} first. Installing only means adding your ${g.name} keys; it takes a minute.`
                                  : `${g.name} is not installed. Ask an owner or admin to install it under Apps.`}
                              </p>
                              {canInstall && (
                                <Button type="button" size="sm" onClick={() => setInstalling(g.id)} data-testid={`wizard-install-${g.id}`}>
                                  <Plus /> Install {g.name}
                                </Button>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                </div>
                <p className="text-xs text-muted-foreground">
                  More gateways are on the way, all free in every edition.{" "}
                  <Link href="/apps" className="font-medium text-primary hover:underline">
                    See apps
                  </Link>
                </p>
                {errors.gateways && <FieldError>{errors.gateways.message ?? errors.gateways.root?.message}</FieldError>}
              </div>
            )}

            {step === 2 && (
              <FieldGroup className="gap-5">
                <div>
                  <h2 className="font-semibold">Where should things go?</h2>
                  <p className="text-sm text-muted-foreground">
                    After paying, customers come back through YaroPay, which checks the payment and then sends them to one of these pages.
                  </p>
                </div>
                <FlowStrip product={values.name || "Your product"} gateways={attachedGatewayDefs.map((g) => g.name)} />
                <Field data-invalid={!!errors.webhookUrl}>
                  <FieldLabel htmlFor="webhookUrl">Webhook endpoint</FieldLabel>
                  <Input id="webhookUrl" placeholder="https://product-b.com/api/payments/webhook" {...register("webhookUrl")} />
                  {errors.webhookUrl ? (
                    <FieldError errors={[errors.webhookUrl]} />
                  ) : (
                    <FieldDescription>YaroPay forwards this product&apos;s payment events here, signed with its own secret.{anyLive && " Must be https for live payments."}</FieldDescription>
                  )}
                </Field>
                <div className="grid gap-5 md:grid-cols-2">
                  <Field data-invalid={!!errors.successUrl}>
                    <FieldLabel htmlFor="successUrl">Success page</FieldLabel>
                    <Input id="successUrl" placeholder="https://product-b.com/checkout/success" {...register("successUrl")} />
                    <FieldError errors={[errors.successUrl]} />
                  </Field>
                  <Field data-invalid={!!errors.failureUrl}>
                    <FieldLabel htmlFor="failureUrl">Failure page</FieldLabel>
                    <Input id="failureUrl" placeholder="https://product-b.com/checkout/failed" {...register("failureUrl")} />
                    <FieldError errors={[errors.failureUrl]} />
                  </Field>
                </div>
                {cancelSupported && (
                  <Field data-invalid={!!errors.cancelUrl}>
                    <FieldLabel htmlFor="cancelUrl">
                      Cancel page <span className="font-normal text-muted-foreground">(optional)</span>
                    </FieldLabel>
                    <Input id="cancelUrl" placeholder="https://product-b.com/cart" {...register("cancelUrl")} />
                    {errors.cancelUrl ? (
                      <FieldError errors={[errors.cancelUrl]} />
                    ) : (
                      <FieldDescription>
                        {attachedGatewayDefs
                          .map((g) =>
                            g.redirects.cancel
                              ? `${g.name} sends cancellations via ${g.redirects.cancelField}`
                              : `${g.name} reports them with ${g.redirects.statusParam}=cancelled`,
                          )
                          .join("; ")}
                        . Left empty, cancelled customers go to the failure page.
                      </FieldDescription>
                    )}
                  </Field>
                )}
                <p className="text-xs text-muted-foreground">Mobile apps can use deep links such as myapp://payment/success for the pages.</p>
              </FieldGroup>
            )}

            {step === 3 && (
              <div className="space-y-5">
                <div className="flex items-center gap-3">
                  <ProductAvatar name={values.name || "?"} slot={values.colorSlot ?? 1} />
                  <div>
                    <h2 className="font-semibold">{values.name}</h2>
                    <p className="text-sm text-muted-foreground">
                      {KIND_LABELS[values.kind ?? "website"]} · {values.websiteUrl}
                    </p>
                  </div>
                </div>
                <dl className="divide-y rounded-xl border text-sm">
                  <Row label="Reference prefix">
                    <code className="font-mono">{values.referencePrefix}_</code>
                  </Row>
                  <Row label="Gateways">
                    <span className="flex flex-wrap justify-end gap-1.5">
                      {attachedConns.map((c) => (
                        <Badge key={c.id} variant="outline" className="gap-1.5">
                          <GatewayMark gatewayId={c.gatewayId} size="sm" className="size-4 text-[7px]" />
                          {requireGateway(c.gatewayId).name} · {c.label}
                          {attached.find((a) => a.connectionId === c.id)?.isDefault && " (default)"}
                        </Badge>
                      ))}
                    </span>
                  </Row>
                  <Row label="Webhook endpoint">{values.webhookUrl}</Row>
                  <Row label="Success page">{values.successUrl}</Row>
                  <Row label="Failure page">{values.failureUrl}</Row>
                  {cancelSupported && <Row label="Cancel page">{values.cancelUrl || "Failure page"}</Row>}
                </dl>
                <div className="flex gap-2 rounded-xl bg-accent/50 p-3 text-sm text-accent-foreground">
                  <Sparkles className="mt-0.5 size-4 shrink-0" />
                  Next you&apos;ll get the product&apos;s API key, signing secret and one callback URL per gateway.
                </div>
                {errors.root && <FieldError>{errors.root.message}</FieldError>}
              </div>
            )}

            <div className="mt-8 flex items-center justify-between gap-3 border-t pt-5">
              <Button type="button" variant="ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
                <ArrowLeft /> Back
              </Button>
              {step < STEPS.length - 1 ? (
                <Button type="submit" data-testid="wizard-next">
                  Continue <ArrowRight />
                </Button>
              ) : (
                <Button type="submit" disabled={create.isPending} data-testid="wizard-create">
                  {create.isPending && <Loader2 className="animate-spin" />}
                  Create product
                </Button>
              )}
            </div>
          </form>
        </Panel>
      </div>

      <InstallDialog
        gatewayId={installing}
        open={!!installing}
        onOpenChange={(o) => !o && setInstalling(null)}
        onInstalled={(c) => toggleConnection(c.id, true)}
      />
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-3">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right break-all">{children}</dd>
    </div>
  )
}

/** Fixed sequence so the example reference does not change on every keystroke. */
function seeded() {
  let i = 0
  const seq = [0.31, 0.92, 0.07, 0.55, 0.73, 0.18, 0.64, 0.41, 0.86, 0.26]
  return () => seq[i++ % seq.length]
}

function FlowStrip({ product, gateways }: { product: string; gateways: string[] }) {
  const steps = [
    { label: product, sub: "starts payment" },
    { label: gateways.join(" / ") || "Gateway", sub: "customer pays" },
    { label: "YaroPay", sub: "verifies + routes" },
    { label: product, sub: "success / failure page" },
  ]
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-xl border bg-muted/30 p-3 text-xs">
      {steps.map((s, i) => (
        <React.Fragment key={i}>
          <div className={cn("rounded-lg border bg-card px-2.5 py-1.5", s.label === "YaroPay" && "border-primary/40 bg-accent/60")}>
            <p className="max-w-36 truncate font-medium">{s.label}</p>
            <p className="text-muted-foreground">{s.sub}</p>
          </div>
          {i < steps.length - 1 && <ArrowRight className="size-3.5 text-muted-foreground" />}
        </React.Fragment>
      ))}
    </div>
  )
}
