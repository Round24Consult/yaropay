"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { ArrowLeft, ExternalLink, KeyRound, Loader2, Lock, Pause, Play, Plus, Send, Trash2 } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { parseAsStringLiteral, useQueryState } from "nuqs"
import * as React from "react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { z } from "zod"
import { InstallDialog } from "@/components/apps/install-dialog"
import { DashboardView } from "@/components/dashboard/dashboard-view"
import { CopyField } from "@/components/shared/copy-field"
import { GatewayMark } from "@/components/shared/gateway-mark"
import { PageHeader, Panel, PanelHeader } from "@/components/shared/page-header"
import { ProductAvatar } from "@/components/shared/product-chip"
import { SampleBadge } from "@/components/onboarding/sample-badge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { ProductWithStats, RotateTarget } from "@yaropay/core/api"
import { installableGateways, requireGateway } from "@yaropay/core/gateways/registry"
import { productDetailsSchema, productUrlsSchema } from "@yaropay/core/schemas"
import type { GatewayConnection } from "@yaropay/core/types"
import { ApiRequestError } from "@/lib/api/client"
import {
  useConnections,
  useDeleteProduct,
  useProduct,
  useRotateProductSecret,
  useSendTestWebhook,
  useSettings,
  useUpdateProduct,
} from "@/lib/api/hooks"
import { useCan } from "@/lib/auth"
import { KIND_LABELS } from "@/lib/format"
import { cn } from "@/lib/utils"
import { DeliveriesTable } from "../webhooks/tables"
import { IntegrationPanel } from "./integration-panel"

const TABS = ["overview", "integration", "gateways", "webhooks", "settings"] as const

export function ProductDetail({ id }: { id: string }) {
  const { data: product, isLoading, error } = useProduct(id)
  const { data: settings } = useSettings()
  const { data: connections = [] } = useConnections()
  const [tab, setTab] = useQueryState("tab", parseAsStringLiteral(TABS).withDefault("overview").withOptions({ history: "replace" }))
  const [state, setState] = React.useState("")
  const update = useUpdateProduct(id)
  const canWrite = useCan("products:write")
  const canKeys = useCan("products:keys")
  const canDelete = useCan("products:delete")
  const showSettings = canWrite || canKeys || canDelete

  if (isLoading) return <Skeleton className="h-96 rounded-2xl" />
  if (error || !product) {
    return (
      <Panel className="p-10 text-center">
        <p className="font-medium">Product not found.</p>
        <Button variant="link" asChild>
          <Link href="/products">Back to products</Link>
        </Button>
      </Panel>
    )
  }

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild className="-ml-2 text-muted-foreground">
        <Link href="/products">
          <ArrowLeft /> Products
        </Link>
      </Button>
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <ProductAvatar name={product.name} slot={product.colorSlot} className="size-10" />
            <span className="min-w-0">
              <span className="flex items-center gap-2">
                {product.name}
                {product.status === "paused" && <Badge variant="secondary">Paused</Badge>}
                {product.sample && <SampleBadge />}
              </span>
              <a
                href={product.websiteUrl.startsWith("http") ? product.websiteUrl : undefined}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 text-sm font-normal text-muted-foreground hover:text-foreground"
              >
                {KIND_LABELS[product.kind]} · {product.websiteUrl.replace(/^https?:\/\//, "")} <ExternalLink className="size-3" />
              </a>
            </span>
          </span>
        }
        actions={
          <>
            <code className="rounded-md border bg-card px-2 py-1 font-mono text-xs text-muted-foreground">{product.referencePrefix}_</code>
            {canWrite && (
              <Button
                variant="outline"
                size="sm"
                disabled={update.isPending}
                onClick={() =>
                  update.mutate(
                    { status: product.status === "active" ? "paused" : "active" },
                    {
                      onSuccess: (p) => toast.success(p.status === "paused" ? `${p.name} paused: new payments are refused` : `${p.name} is live again`),
                      onError: (e) => toast.error(e.message),
                    },
                  )
                }
              >
                {product.status === "active" ? <Pause /> : <Play />}
                {product.status === "active" ? "Pause" : "Resume"}
              </Button>
            )}
          </>
        }
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as (typeof TABS)[number])}>
        <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="integration" data-testid="tab-integration">
              Integration
            </TabsTrigger>
            <TabsTrigger value="gateways">Gateways</TabsTrigger>
            <TabsTrigger value="webhooks">Webhooks</TabsTrigger>
            {showSettings && <TabsTrigger value="settings">Settings</TabsTrigger>}
          </TabsList>
        </div>
        <TabsContent value="overview" className="mt-5">
          <DashboardView scopeProductId={product.id} />
        </TabsContent>
        <TabsContent value="integration" className="mt-5">
          {settings && <IntegrationPanel product={product} baseUrl={settings.baseUrl} connections={connections} />}
        </TabsContent>
        <TabsContent value="gateways" className="mt-5">
          <GatewaysTab product={product} connections={connections} />
        </TabsContent>
        <TabsContent value="webhooks" className="mt-5 space-y-4">
          {canWrite && <TestWebhookCard product={product} />}
          <DeliveriesTable productId={product.id} state={state} onState={setState} />
        </TabsContent>
        {showSettings && (
          <TabsContent value="settings" className="mt-5">
            <SettingsTab product={product} connections={connections} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  )
}

function TestWebhookCard({ product }: { product: ProductWithStats }) {
  const send = useSendTestWebhook(product.id)
  const run = async () => {
    try {
      const d = await send.mutateAsync()
      if (d.state === "delivered") toast.success(`Test event delivered: ${d.statusCode} in ${d.latencyMs} ms`)
      else if (d.statusCode) toast.warning(`Your endpoint answered ${d.statusCode}. Check the delivery below for the response.`)
      else toast.warning("Your endpoint did not respond. Check that it is reachable from this server.")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not send the test event")
    }
  }
  return (
    <Panel className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">Send a test event</p>
        <p className="truncate text-xs text-muted-foreground">
          POSTs a signed <code className="font-mono">test.ping</code> to{" "}
          <span className="font-mono" title={product.webhookUrl}>
            {product.webhookUrl}
          </span>
        </p>
      </div>
      <Button variant="outline" size="sm" onClick={run} disabled={send.isPending} data-testid="send-test-webhook">
        {send.isPending ? <Loader2 className="animate-spin" /> : <Send />}
        Send test event
      </Button>
    </Panel>
  )
}

function GatewaysTab({ product, connections }: { product: ProductWithStats; connections: GatewayConnection[] }) {
  const update = useUpdateProduct(product.id)
  const canWrite = useCan("products:write")
  const canInstall = useCan("gateways:write")
  const [installing, setInstalling] = React.useState<string | null>(null)
  const save = (gateways: ProductWithStats["gateways"]) => {
    if (gateways.length === 0) {
      toast.error("A product needs at least one gateway")
      return
    }
    if (!gateways.some((g) => g.isDefault)) gateways = gateways.map((g, i) => ({ ...g, isDefault: i === 0 }))
    update.mutate({ gateways }, { onSuccess: () => toast.success("Gateways updated"), onError: (e) => toast.error(e.message) })
  }
  return (
    <div className="space-y-4">
      {installableGateways.map((g) => {
          const conns = connections.filter((c) => c.gatewayId === g.id && (product.sample || !c.sample))
          return (
            <Panel key={g.id}>
              <PanelHeader
                title={
                  <span className="flex items-center gap-2">
                    <GatewayMark gatewayId={g.id} size="sm" /> {g.name}
                  </span>
                }
                description={g.tagline}
                actions={
                  canInstall && canWrite ? (
                    <Button variant="ghost" size="sm" onClick={() => setInstalling(g.id)}>
                      <Plus /> {conns.length ? "Add account" : `Install ${g.name}`}
                    </Button>
                  ) : null
                }
              />
              <div className="p-5 pt-3">
                {conns.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Not installed. Install it to let {product.name} take payments through {g.name}.</p>
                ) : (
                  <ul className="divide-y rounded-xl border">
                    {conns.map((c) => {
                      const sel = product.gateways.find((x) => x.connectionId === c.id)
                      return (
                        <li key={c.id} className="flex items-center gap-3 px-3 py-2.5">
                          <Checkbox
                            id={`pg-${c.id}`}
                            checked={!!sel}
                            disabled={update.isPending || !canWrite}
                            onCheckedChange={(v) =>
                              save(v ? [...product.gateways, { connectionId: c.id, isDefault: false }] : product.gateways.filter((x) => x.connectionId !== c.id))
                            }
                          />
                          <label htmlFor={`pg-${c.id}`} className="flex flex-1 items-center gap-2 text-sm">
                            <span className={cn("size-1.5 rounded-full", c.mode === "live" ? "bg-good" : "bg-warning")} />
                            {c.label}
                            <span className="text-xs text-muted-foreground capitalize">{c.mode}</span>
                          </label>
                          {sel &&
                            (sel.isDefault ? (
                              <Badge variant="secondary">Default</Badge>
                            ) : !canWrite ? null : (
                              <Button
                                variant="ghost"
                                size="xs"
                                onClick={() => save(product.gateways.map((x) => ({ ...x, isDefault: x.connectionId === c.id })))}
                              >
                                Make default
                              </Button>
                            ))}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            </Panel>
          )
        })}
      <InstallDialog
        gatewayId={installing}
        open={!!installing}
        onOpenChange={(o) => !o && setInstalling(null)}
        onInstalled={(c) => save([...product.gateways, { connectionId: c.id, isDefault: product.gateways.length === 0 }])}
      />
    </div>
  )
}

const settingsSchema = productDetailsSchema.pick({ name: true, websiteUrl: true, referencePrefix: true }).extend(productUrlsSchema.shape)
type SettingsValues = z.infer<typeof settingsSchema>

function SettingsTab({ product, connections }: { product: ProductWithStats; connections: GatewayConnection[] }) {
  const update = useUpdateProduct(product.id)
  const rotate = useRotateProductSecret(product.id)
  const del = useDeleteProduct()
  const router = useRouter()
  const canWrite = useCan("products:write")
  const canKeys = useCan("products:keys")
  const canDelete = useCan("products:delete")
  const [secret, setSecret] = React.useState<{ which: string; secret: string } | null>(null)
  const [confirm, setConfirm] = React.useState(false)
  // Show the cancel page only when an attached gateway can report cancellations.
  const supportsCancel = product.gateways.some((g) => {
    const c = connections.find((x) => x.id === g.connectionId)
    if (!c) return false
    const def = requireGateway(c.gatewayId)
    return def.redirects.cancel || !!def.redirects.statusParam
  })
  const form = useForm<SettingsValues>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      name: product.name,
      websiteUrl: product.websiteUrl,
      referencePrefix: product.referencePrefix,
      webhookUrl: product.webhookUrl,
      successUrl: product.successUrl,
      failureUrl: product.failureUrl,
      cancelUrl: product.cancelUrl ?? "",
    },
  })
  const errors = form.formState.errors
  const submit = form.handleSubmit(async (values) => {
    try {
      await update.mutateAsync(values)
      form.reset(values)
      toast.success("Saved")
    } catch (e) {
      if (e instanceof ApiRequestError && e.fields) {
        for (const [k, m] of Object.entries(e.fields)) form.setError(k as keyof SettingsValues, { message: m })
      } else toast.error("Could not save")
    }
  })
  const prefixChanged = form.watch("referencePrefix") !== product.referencePrefix

  const field = (name: keyof SettingsValues, label: string, hint?: string, mono?: boolean) => (
    <Field data-invalid={!!errors[name]}>
      <FieldLabel htmlFor={`s-${name}`}>{label}</FieldLabel>
      <Input id={`s-${name}`} className={cn(mono && "font-mono uppercase")} {...form.register(name)} />
      {errors[name] ? <FieldError errors={[errors[name]]} /> : hint ? <FieldDescription>{hint}</FieldDescription> : null}
    </Field>
  )

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <Panel className="lg:col-span-3">
        <PanelHeader
          title="Product settings"
          description={
            canWrite ? undefined : (
              <span className="inline-flex items-center gap-1">
                <Lock className="size-3" /> Read-only for your role
              </span>
            )
          }
        />
        <form onSubmit={submit} className="p-5" noValidate>
          <fieldset disabled={!canWrite} className="contents">
          <FieldGroup className="gap-5">
            <div className="grid gap-5 sm:grid-cols-2">
              {field("name", "Name")}
              {field("websiteUrl", "Website or app URL")}
            </div>
            {field(
              "referencePrefix",
              "Reference prefix",
              prefixChanged ? "Payments already in flight keep the old prefix and still route by metadata." : "Stamped on every payment this product starts.",
              true,
            )}
            {field("webhookUrl", "Webhook endpoint", "Where YaroPay forwards this product's events.")}
            <div className="grid gap-5 sm:grid-cols-2">
              {field("successUrl", "Success page")}
              {field("failureUrl", "Failure page")}
            </div>
            {supportsCancel && field("cancelUrl", "Cancel page (optional)", "Empty sends cancelled customers to the failure page.")}
          </FieldGroup>
          </fieldset>
          {canWrite && (
            <div className="mt-6 flex justify-end gap-2 border-t pt-5">
              <Button type="button" variant="ghost" disabled={!form.formState.isDirty} onClick={() => form.reset()}>
                Discard
              </Button>
              <Button type="submit" disabled={!form.formState.isDirty || update.isPending}>
                {update.isPending && <Loader2 className="animate-spin" />}
                Save changes
              </Button>
            </div>
          )}
        </form>
      </Panel>

      <div className="min-w-0 space-y-6 lg:col-span-2">
        {canKeys && (
        <Panel>
          <PanelHeader title="Keys" description="Rotating replaces the old value immediately." />
          <div className="space-y-3 p-5 pt-3">
            {(
              [
                ["apiKey", "Live API key", product.apiKeyPreview],
                ["testApiKey", "Test API key", product.testApiKeyPreview],
                ["signingSecret", "Webhook signing secret", product.signingSecretPreview],
              ] as const satisfies readonly (readonly [RotateTarget, string, string])[]
            ).map(([which, label, preview]) => (
              <div key={which} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{label}</p>
                  <code className="font-mono text-xs text-muted-foreground">{preview}</code>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={rotate.isPending}
                  data-testid={`rotate-${which}`}
                  onClick={async () => {
                    try {
                      const res = await rotate.mutateAsync(which)
                      setSecret({ which: label, secret: res.secret })
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : "Could not rotate")
                    }
                  }}
                >
                  <KeyRound /> Rotate
                </Button>
              </div>
            ))}
          </div>
        </Panel>
        )}
        {canDelete && (
          <Panel className="border-destructive/30">
            <PanelHeader title="Delete product" description="Stops taking payments for this product. Past payments stay in your history." />
            <div className="p-5 pt-3">
              <Button variant="destructive" size="sm" onClick={() => setConfirm(true)}>
                <Trash2 /> Delete {product.name}
              </Button>
            </div>
          </Panel>
        )}
      </div>

      <Dialog open={!!secret} onOpenChange={(o) => !o && setSecret(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New {secret?.which.toLowerCase()}</DialogTitle>
            <DialogDescription>Copy it now. For your security it will not be shown again.</DialogDescription>
          </DialogHeader>
          {secret && <CopyField label={secret.which} value={secret.secret} />}
          <DialogFooter>
            <Button onClick={() => setSecret(null)}>I&apos;ve saved it</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {product.name}?</DialogTitle>
            <DialogDescription>
              New payments with the {product.referencePrefix}_ prefix will show up as unrouted. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={del.isPending}
              onClick={async () => {
                try {
                  await del.mutateAsync(product.id)
                  toast.success(`${product.name} deleted`)
                  router.push("/products")
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Could not delete")
                }
              }}
            >
              Delete product
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

