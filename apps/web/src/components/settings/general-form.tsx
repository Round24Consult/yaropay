"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { DEFAULT_GATEWAY_ID, requireGateway } from "@yaropay/core/gateways/registry"
import { CURRENCIES } from "@yaropay/core/money"
import { settingsSchema } from "@yaropay/core/schemas"
import type { PlatformSettings } from "@yaropay/core/types"
import { gatewayWebhookUrl, isHttpUrl, productCallbackUrl } from "@yaropay/core/urls"
import { BellRing, Loader2, Lock } from "lucide-react"
import { Controller, type Resolver, useForm, useWatch } from "react-hook-form"
import { toast } from "sonner"
import type { z } from "zod"
import { SampleDataPanel } from "@/components/onboarding/sample-data"
import { Panel, PanelHeader } from "@/components/shared/page-header"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useConnections, useProducts, useTestAlerts, useUpdateSettings } from "@/lib/api/hooks"
import { useCan } from "@/lib/auth"
import { applyApiErrors } from "@/lib/forms"

type Values = z.infer<typeof settingsSchema>

function toValues(s: PlatformSettings): Values {
  return {
    platformName: s.platformName,
    companyName: s.companyName,
    baseUrl: s.baseUrl,
    defaultCurrency: s.defaultCurrency,
    alertsWebhookUrl: s.alertsWebhookUrl ?? "",
  }
}

export function GeneralForm({ settings }: { settings: PlatformSettings }) {
  const canWrite = useCan("settings:write")
  const update = useUpdateSettings()
  const testAlerts = useTestAlerts()
  const { data: connections = [] } = useConnections()
  const { data: products = [] } = useProducts()
  const form = useForm<Values>({ resolver: zodResolver(settingsSchema) as Resolver<Values>, defaultValues: toValues(settings) })
  const baseUrl = useWatch({ control: form.control, name: "baseUrl" })
  const previewBase = isHttpUrl(baseUrl) ? baseUrl : settings.baseUrl
  const errors = form.formState.errors
  const dirty = form.formState.dirtyFields

  const submit = form.handleSubmit(async (values) => {
    const body: Partial<PlatformSettings> = {
      platformName: values.platformName,
      companyName: values.companyName,
      baseUrl: values.baseUrl,
      defaultCurrency: values.defaultCurrency,
    }
    // A masked value means "unchanged"; only send the alert URL when it was edited.
    if (dirty.alertsWebhookUrl) body.alertsWebhookUrl = values.alertsWebhookUrl ? values.alertsWebhookUrl : null
    try {
      const saved = await update.mutateAsync(body)
      form.reset(toValues(saved))
      toast.success(dirty.baseUrl ? "Settings saved. Generated URLs now use the new base URL." : "Settings saved")
    } catch (e) {
      const message = applyApiErrors(form, e)
      if (message) toast.error(message)
    }
  })

  const sendTest = async () => {
    try {
      const res = await testAlerts.mutateAsync()
      if (res.ok) toast.success(res.message)
      else toast.error(res.message)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not send the test alert")
    }
  }

  const conn = connections[0]
  const previewGateway = conn?.gatewayId ?? DEFAULT_GATEWAY_ID
  const previews: [string, string][] = [
    [`${requireGateway(previewGateway).name} webhook`, gatewayWebhookUrl(previewBase, previewGateway, conn?.id ?? "con_example")],
    ...(products.length
      ? products.slice(0, 2).map((p): [string, string] => [`${p.name} callback`, productCallbackUrl(previewBase, p.id, previewGateway)])
      : [["Product callback", productCallbackUrl(previewBase, "prd_example", previewGateway)] as [string, string]]),
  ]

  return (
    <div className="space-y-6">
      <Panel>
        <PanelHeader
          title="General"
          description={
            canWrite ? (
              "The base URL is the public address of this install. Every webhook and callback URL is built from it."
            ) : (
              <span className="inline-flex items-center gap-1">
                <Lock className="size-3" /> Only owners and admins can change these settings.
              </span>
            )
          }
        />
        <form onSubmit={submit} className="grid gap-6 p-5 lg:grid-cols-5" noValidate>
          <fieldset disabled={!canWrite} className="contents">
            <FieldGroup className="gap-5 lg:col-span-3">
              <div className="grid gap-5 sm:grid-cols-2">
                <Field data-invalid={!!errors.platformName}>
                  <FieldLabel htmlFor="platformName">Platform name</FieldLabel>
                  <Input id="platformName" {...form.register("platformName")} />
                  <FieldError errors={[errors.platformName]} />
                </Field>
                <Field data-invalid={!!errors.companyName}>
                  <FieldLabel htmlFor="companyName">Company</FieldLabel>
                  <Input id="companyName" {...form.register("companyName")} />
                  <FieldError errors={[errors.companyName]} />
                </Field>
              </div>
              <Field data-invalid={!!errors.baseUrl}>
                <FieldLabel htmlFor="baseUrl">Public base URL</FieldLabel>
                <Input id="baseUrl" className="font-mono text-[13px]" {...form.register("baseUrl")} data-testid="base-url" />
                {errors.baseUrl ? (
                  <FieldError errors={[errors.baseUrl]} />
                ) : (
                  <FieldDescription>Changing it means updating the webhook URL in each gateway dashboard.</FieldDescription>
                )}
              </Field>
              <Field>
                <FieldLabel>Default currency</FieldLabel>
                <Controller
                  control={form.control}
                  name="defaultCurrency"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange} disabled={!canWrite}>
                      <SelectTrigger className="w-60 max-w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CURRENCIES.map((c) => (
                          <SelectItem key={c.code} value={c.code}>
                            <span className="font-mono text-xs">{c.code}</span> {c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>
              <Field data-invalid={!!errors.alertsWebhookUrl}>
                <FieldLabel htmlFor="alertsWebhookUrl">Alerts webhook URL</FieldLabel>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    id="alertsWebhookUrl"
                    className="font-mono text-[13px]"
                    placeholder="https://hooks.slack.com/services/…"
                    autoComplete="off"
                    {...form.register("alertsWebhookUrl")}
                  />
                  {canWrite && (
                    <Button
                      type="button"
                      variant="outline"
                      className="shrink-0"
                      disabled={!settings.alertsWebhookUrl || !!dirty.alertsWebhookUrl || testAlerts.isPending}
                      onClick={sendTest}
                    >
                      {testAlerts.isPending ? <Loader2 className="animate-spin" /> : <BellRing />}
                      Send test alert
                    </Button>
                  )}
                </div>
                {errors.alertsWebhookUrl ? (
                  <FieldError errors={[errors.alertsWebhookUrl]} />
                ) : (
                  <FieldDescription>
                    Slack, Discord, Teams or any endpoint that accepts {"{ \"text\": \"…\" }"}. Failed deliveries, rejected signatures and
                    gateway errors are posted here. Leave empty to turn off.
                  </FieldDescription>
                )}
              </Field>
              {canWrite && (
                <div className="flex gap-2">
                  <Button type="submit" disabled={!form.formState.isDirty || update.isPending} data-testid="save-settings">
                    {update.isPending && <Loader2 className="animate-spin" />}
                    Save
                  </Button>
                  <Button type="button" variant="ghost" disabled={!form.formState.isDirty} onClick={() => form.reset()}>
                    Discard
                  </Button>
                </div>
              )}
            </FieldGroup>
          </fieldset>
          <div className="min-w-0 space-y-3 self-start rounded-xl border bg-muted/30 p-4 lg:col-span-2">
            <p className="text-xs font-medium text-muted-foreground">Preview of generated URLs</p>
            {previews.map(([label, url]) => (
              <div key={label}>
                <p className="text-[11px] text-muted-foreground">{label}</p>
                <code className="block font-mono text-[11.5px] break-all">{url}</code>
              </div>
            ))}
          </div>
        </form>
      </Panel>
      {canWrite && <SampleDataPanel />}
    </div>
  )
}
