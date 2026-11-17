"use client"

// YaroPay Enterprise License: see LICENSE.md in this folder.

import { zodResolver } from "@hookform/resolvers/zod"
import { type Entitlements, FEATURE_INFO, FEATURES, type LicenceSummary, licenceKeySchema } from "@yaropay/core/editions"
import { Check, ExternalLink, KeyRound, Loader2, Lock } from "lucide-react"
import * as React from "react"
import { type Resolver, useForm } from "react-hook-form"
import { toast } from "sonner"
import type { z } from "zod"
import { Panel, PanelHeader } from "@/components/shared/page-header"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { useEntitlements, useInstallLicence, useRemoveLicence } from "@/lib/api/hooks"
import { useCan } from "@/lib/auth"
import { applyApiErrors } from "@/lib/forms"
import { formatDate } from "@/lib/format"

const PRICING_URL = "https://yaropay.com/#pricing"

const EDITION_COPY: Record<Entitlements["edition"], { name: string; about: string }> = {
  community: {
    name: "YaroPay Community",
    about: "The free, open-source edition: one company, unlimited products, both gateways, signed webhooks, roles and notifications. The features below come with YaroPay Enterprise.",
  },
  enterprise: {
    name: "YaroPay Enterprise",
    about: "Your licence key decides which paid features this install can use. Payments keep working whatever its status.",
  },
  cloud: { name: "YaroPay Cloud", about: "Hosted by YaroPay. Your plan decides which paid features this company can use." },
}

export function LicencePanel() {
  const { data } = useEntitlements()
  if (!data) return <Skeleton className="h-96 rounded-2xl" />
  const copy = EDITION_COPY[data.edition]
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="min-w-0 space-y-6">
        <Panel data-testid="edition-panel">
          <PanelHeader
            title={copy.name}
            description={copy.about}
            actions={
              data.edition !== "cloud" && (
                <Button variant="outline" size="sm" asChild>
                  <a href={PRICING_URL} target="_blank" rel="noreferrer">
                    Compare editions <ExternalLink />
                  </a>
                </Button>
              )
            }
          />
          {data.acceptsLicence && (
            <div className="space-y-5 p-5">
              <LicenceStatus licence={data.licence} />
              <LicenceForm hasLicence={!!data.licence} />
            </div>
          )}
        </Panel>
      </div>
      <Panel>
        <PanelHeader title="Paid features" description="What this company can use now. Locked features show what each edition adds." />
        <ul className="divide-y">
          {FEATURES.map((f) => {
            const on = data.features.includes(f)
            return (
              <li key={f} className="flex items-start gap-3 px-5 py-3.5" data-testid={`feature-${f}`} data-enabled={on}>
                <span className={on ? "mt-0.5 text-good" : "mt-0.5 text-muted-foreground"}>{on ? <Check className="size-4" /> : <Lock className="size-4" />}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{FEATURE_INFO[f].label}</p>
                  <p className="text-sm text-muted-foreground">{FEATURE_INFO[f].description}</p>
                </div>
                {!on && (
                  <Badge variant="outline" className="shrink-0">
                    {data.edition === "cloud" ? "Upgrade" : "Enterprise"}
                  </Badge>
                )}
              </li>
            )
          })}
        </ul>
      </Panel>
    </div>
  )
}

function LicenceStatus({ licence }: { licence: LicenceSummary | null }) {
  if (!licence) {
    return (
      <Alert>
        <KeyRound />
        <AlertTitle>No licence key yet</AlertTitle>
        <AlertDescription>Paid features stay locked until you add one. Everything else, including payments, works as usual.</AlertDescription>
      </Alert>
    )
  }
  const limits = [
    licence.liveProducts === null ? "unlimited live products" : `${licence.liveProducts} live product${licence.liveProducts === 1 ? "" : "s"} a month`,
    licence.features.includes("multi_workspace") ? (licence.workspaces === null ? "unlimited companies" : `${licence.workspaces} companies`) : null,
  ].filter(Boolean)
  if (licence.status === "valid") {
    return (
      <Alert data-testid="licence-status">
        <Check />
        <AlertTitle>
          Licensed to {licence.customer} <Badge variant="secondary">Valid</Badge>
        </AlertTitle>
        <AlertDescription>
          Until {formatDate(licence.expiresAt)}, {limits.join(", ")}.
        </AlertDescription>
      </Alert>
    )
  }
  return (
    <Alert variant="destructive" data-testid="licence-status">
      <Lock />
      <AlertTitle>{licence.status === "grace" ? `Licence expired on ${formatDate(licence.expiresAt)}` : "Licence expired"}</AlertTitle>
      <AlertDescription>
        {licence.status === "grace"
          ? `Paid features keep working until ${formatDate(licence.graceEndsAt)}. Add a renewed key before then.`
          : `Paid features are locked since ${formatDate(licence.graceEndsAt)}. Payments keep working. Add a renewed key to unlock them.`}
      </AlertDescription>
    </Alert>
  )
}

type KeyValues = z.infer<typeof licenceKeySchema>

function LicenceForm({ hasLicence }: { hasLicence: boolean }) {
  const canManage = useCan("settings:write")
  const install = useInstallLicence()
  const remove = useRemoveLicence()
  const [confirmRemove, setConfirmRemove] = React.useState(false)
  const form = useForm<KeyValues>({ resolver: zodResolver(licenceKeySchema) as Resolver<KeyValues>, defaultValues: { key: "" } })
  const errors = form.formState.errors
  if (!canManage) return <p className="text-sm text-muted-foreground">Ask an owner or admin to manage the licence.</p>

  const submit = form.handleSubmit(async ({ key }) => {
    try {
      const { licence } = await install.mutateAsync(key)
      form.reset({ key: "" })
      toast.success(`Licence added for ${licence.customer}`)
    } catch (e) {
      const message = applyApiErrors(form, e)
      if (message) toast.error(message)
    }
  })

  return (
    <>
      <form onSubmit={submit} noValidate className="space-y-4">
        <Field data-invalid={!!errors.key}>
          <FieldLabel htmlFor="licence-key">{hasLicence ? "Replace the licence key" : "Licence key"}</FieldLabel>
          <Textarea id="licence-key" rows={4} spellCheck={false} autoComplete="off" placeholder="YP1.…" className="font-mono text-xs" {...form.register("key")} />
          <FieldDescription>Paste the key from your YaroPay Enterprise order. It is checked on this server; nothing is sent anywhere.</FieldDescription>
          <FieldError errors={[errors.key]} />
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="sm" disabled={install.isPending}>
            {install.isPending && <Loader2 className="animate-spin" />}
            {hasLicence ? "Replace key" : "Add licence key"}
          </Button>
          {hasLicence && (
            <Button type="button" variant="outline" size="sm" onClick={() => setConfirmRemove(true)}>
              Remove licence
            </Button>
          )}
        </div>
      </form>
      <Dialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove the licence?</DialogTitle>
            <DialogDescription>Paid features lock straight away. Payments, webhooks and everything in Community keep working. You can add the key again later.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmRemove(false)}>
              Keep it
            </Button>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={async () => {
                try {
                  await remove.mutateAsync()
                  setConfirmRemove(false)
                  toast.success("Licence removed")
                } catch {
                  toast.error("Couldn't remove the licence. Try again.")
                }
              }}
            >
              {remove.isPending && <Loader2 className="animate-spin" />}
              Remove licence
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
