"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { CheckCircle2, Eye, EyeOff, KeyRound, Loader2, ShieldCheck, XCircle } from "lucide-react"
import * as React from "react"
import { Controller, type Resolver, useForm } from "react-hook-form"
import { z } from "zod"
import { GatewayMark } from "@/components/shared/gateway-mark"
import { Button } from "@/components/ui/button"
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
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import { buildCredentialSchema } from "@yaropay/core/gateways/credentials"
import { requireGateway } from "@yaropay/core/gateways/registry"
import type { GatewayDefinition } from "@yaropay/core/gateways/types"
import type { GatewayConnection, Mode } from "@yaropay/core/types"
import { ApiRequestError } from "@/lib/api/client"
import { useConnections, useInstallConnection, useTestConnection } from "@/lib/api/hooks"
import { useMode } from "@/lib/mode"
import { cn } from "@/lib/utils"
import { SetupGuide } from "./setup-guide"

interface FormValues {
  label: string
  mode: Mode
  credentials: Record<string, string>
}

/** Validates against the gateway's own field definitions for the chosen mode. */
function resolverFor(gateway: GatewayDefinition): Resolver<FormValues> {
  return (values, ctx, opts) => {
    const schema = z.object({
      label: z.string().trim().min(2, "Give this account a name").max(48),
      mode: z.enum(["test", "live"]),
      credentials: buildCredentialSchema(gateway, values.mode),
    })
    return (zodResolver(schema) as unknown as Resolver<FormValues>)(values, ctx, opts)
  }
}

function SecretInput({ id, invalid, ...props }: React.ComponentProps<"input"> & { invalid?: boolean }) {
  const [shown, setShown] = React.useState(false)
  return (
    <InputGroup>
      <InputGroupInput
        id={id}
        type={shown ? "text" : "password"}
        autoComplete="off"
        spellCheck={false}
        aria-invalid={invalid}
        className="font-mono text-[13px]"
        {...props}
      />
      <InputGroupAddon align="inline-end">
        <InputGroupButton size="icon-xs" onClick={() => setShown((s) => !s)} aria-label={shown ? "Hide value" : "Show value"}>
          {shown ? <EyeOff /> : <Eye />}
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  )
}

export function InstallDialog({
  gatewayId,
  open,
  onOpenChange,
  onInstalled,
  defaultLabel,
}: {
  gatewayId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onInstalled?: (connection: GatewayConnection) => void
  defaultLabel?: string
}) {
  const gateway = gatewayId ? requireGateway(gatewayId) : null
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-xl">
        {gateway ? (
          <InstallFlow
            key={gateway.id}
            gateway={gateway}
            defaultLabel={defaultLabel}
            onDone={() => onOpenChange(false)}
            onInstalled={onInstalled}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function InstallFlow({
  gateway,
  onDone,
  onInstalled,
  defaultLabel,
}: {
  gateway: GatewayDefinition
  onDone: () => void
  onInstalled?: (c: GatewayConnection) => void
  defaultLabel?: string
}) {
  const { mode: appMode } = useMode()
  const { data: connections = [] } = useConnections()
  const install = useInstallConnection()
  // Suggest a name that is not taken yet for this gateway.
  const taken = new Set(connections.filter((c) => c.gatewayId === gateway.id).map((c) => c.label.toLowerCase()))
  const base = appMode === "test" ? "Sandbox" : "Main account"
  let suggested = base
  for (let i = 2; taken.has(suggested.toLowerCase()); i++) suggested = `${base === "Sandbox" ? "Sandbox" : "Account"} ${i}`
  const test = useTestConnection()
  const [installed, setInstalled] = React.useState<GatewayConnection | null>(null)
  const form = useForm<FormValues>({
    resolver: resolverFor(gateway),
    defaultValues: {
      label: defaultLabel ?? suggested,
      mode: appMode,
      credentials: Object.fromEntries(gateway.credentialFields.map((f) => [f.key, ""])),
    },
    mode: "onTouched",
  })
  const mode = form.watch("mode")

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const connection = await install.mutateAsync({ gatewayId: gateway.id, ...values })
      setInstalled(connection)
      onInstalled?.(connection)
    } catch (e) {
      if (e instanceof ApiRequestError && e.fields) {
        for (const [key, message] of Object.entries(e.fields)) {
          form.setError(key as `credentials.${string}`, { message })
        }
      } else {
        form.setError("root", { message: e instanceof Error ? e.message : "Install failed" })
      }
    }
  })

  const runTest = async () => {
    const valid = await form.trigger("credentials")
    if (!valid) return
    test.mutate({ gatewayId: gateway.id, mode, credentials: form.getValues("credentials") })
  }

  if (installed) {
    return (
      <>
        <DialogHeader>
          <div className="mb-1 flex items-center gap-3">
            <GatewayMark gatewayId={gateway.id} size="lg" />
            <span className="grid size-6 place-items-center rounded-full bg-good/15 text-good-text">
              <CheckCircle2 className="size-4" />
            </span>
          </div>
          <DialogTitle>{gateway.name} is installed</DialogTitle>
          <DialogDescription>
            One last step: tell {gateway.name} where to send events. Paste these URLs into your {gateway.name} dashboard.
          </DialogDescription>
        </DialogHeader>
        <SetupGuide gateway={gateway} connection={installed} />
        <DialogFooter>
          <Button onClick={onDone} data-testid="install-done">
            Done
          </Button>
        </DialogFooter>
      </>
    )
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <DialogHeader>
        <div className="mb-1 flex items-center gap-3">
          <GatewayMark gatewayId={gateway.id} size="lg" />
        </div>
        <DialogTitle>Install {gateway.name}</DialogTitle>
        <DialogDescription>
          Add your {gateway.name} keys once. Every product you attach to this account will use them, and YaroPay keeps each
          product&apos;s payments separate.
        </DialogDescription>
      </DialogHeader>

      <FieldGroup className="mt-5 gap-5">
        <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
          <Field data-invalid={!!form.formState.errors.label}>
            <FieldLabel htmlFor="label">Account name</FieldLabel>
            <Input id="label" {...form.register("label")} aria-invalid={!!form.formState.errors.label} />
            <FieldError errors={[form.formState.errors.label]} />
          </Field>
          <Field>
            <FieldLabel>Mode</FieldLabel>
            <Controller
              control={form.control}
              name="mode"
              render={({ field }) => (
                <div role="radiogroup" aria-label="Key mode" className="grid h-8 grid-cols-2 rounded-lg border bg-background p-0.5 text-xs font-medium">
                  {(["test", "live"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      role="radio"
                      aria-checked={field.value === m}
                      onClick={() => {
                        field.onChange(m)
                        test.reset()
                        if (form.formState.isSubmitted) form.trigger("credentials")
                      }}
                      className={cn(
                        "flex items-center justify-center gap-1.5 rounded-md px-3 capitalize",
                        field.value === m ? "bg-secondary text-foreground shadow-sm" : "text-muted-foreground",
                      )}
                    >
                      <span className={cn("size-1.5 rounded-full", m === "live" ? "bg-good" : "bg-warning")} />
                      {m}
                    </button>
                  ))}
                </div>
              )}
            />
          </Field>
        </div>

        {gateway.credentialFields.map((f) => {
          const err = form.formState.errors.credentials?.[f.key]
          const reg = form.register(`credentials.${f.key}`, { onChange: () => test.reset() })
          return (
            <Field key={f.key} data-invalid={!!err}>
              <FieldLabel htmlFor={`cred-${f.key}`}>
                {f.label}
                {f.type === "secret" && <KeyRound className="size-3 text-muted-foreground" aria-label="secret" />}
              </FieldLabel>
              {f.type === "secret" ? (
                <SecretInput id={`cred-${f.key}`} placeholder={f.prefix?.[mode] ? `${f.prefix[mode]}…` : f.placeholder} invalid={!!err} {...reg} />
              ) : (
                <Input
                  id={`cred-${f.key}`}
                  placeholder={f.prefix?.[mode] ? `${f.prefix[mode]}…` : f.placeholder}
                  className="font-mono text-[13px]"
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={!!err}
                  {...reg}
                />
              )}
              {err ? <FieldError errors={[err]} /> : f.help ? <FieldDescription>{f.help}</FieldDescription> : null}
            </Field>
          )
        })}

        <div className="flex gap-2.5 rounded-xl border bg-muted/40 p-3 text-xs text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-foreground" aria-hidden />
          <p>
            <span className="font-medium text-foreground">Webhook verification. </span>
            {gateway.webhook.note} Secrets are encrypted at rest and never shown again in full.
          </p>
        </div>

        {test.data && (
          <div
            role="status"
            className={cn(
              "flex items-start gap-2 rounded-xl border p-3 text-sm",
              test.data.ok ? "border-good/30 bg-good/5" : "border-critical/30 bg-critical/5",
            )}
          >
            {test.data.ok ? <CheckCircle2 className="mt-0.5 size-4 text-good-text" /> : <XCircle className="mt-0.5 size-4 text-critical-text" />}
            <div>
              <p className="font-medium">{test.data.ok ? "Connection works" : "Connection failed"}</p>
              <p className="text-xs text-muted-foreground">
                {test.data.message}
                {test.data.business ? ` Business: ${test.data.business}.` : ""}
              </p>
            </div>
          </div>
        )}
        {test.error && (
          <div role="status" className="flex items-start gap-2 rounded-xl border border-critical/30 bg-critical/5 p-3 text-sm">
            <XCircle className="mt-0.5 size-4 text-critical-text" />
            <div>
              <p className="font-medium">Could not test the connection</p>
              <p className="text-xs text-muted-foreground">{test.error.message}</p>
            </div>
          </div>
        )}
        {form.formState.errors.root && <FieldError>{form.formState.errors.root.message}</FieldError>}
      </FieldGroup>

      <DialogFooter className="mt-6 gap-2 sm:justify-between">
        <Button type="button" variant="outline" onClick={runTest} disabled={test.isPending}>
          {test.isPending ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
          Test connection
        </Button>
        <Button type="submit" disabled={install.isPending} data-testid="install-submit">
          {install.isPending && <Loader2 className="animate-spin" />}
          Install {gateway.name}
        </Button>
      </DialogFooter>
    </form>
  )
}
