"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { ArrowLeft, KeyRound, Loader2, Trash2 } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import * as React from "react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { GatewayMark } from "@/components/shared/gateway-mark"
import { PageHeader, Panel, PanelHeader } from "@/components/shared/page-header"
import { ProductChip } from "@/components/shared/product-chip"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { buildCredentialSchema } from "@yaropay/core/gateways/credentials"
import type { GatewayDefinition } from "@yaropay/core/gateways/types"
import type { GatewayConnection } from "@yaropay/core/types"
import { ApiRequestError } from "@/lib/api/client"
import { useConnection, useDeleteConnection, useUpdateConnection } from "@/lib/api/hooks"
import { useCan } from "@/lib/auth"
import { formatDate, formatRelative } from "@/lib/format"
import { cn } from "@/lib/utils"
import { SetupGuide } from "./setup-guide"
import { SampleBadge } from "@/components/onboarding/sample-badge"

export function ConnectionView({ id }: { id: string }) {
  const { data, isLoading, error } = useConnection(id)
  const router = useRouter()
  const del = useDeleteConnection()
  const [rotating, setRotating] = React.useState(false)
  const [confirmDelete, setConfirmDelete] = React.useState(false)
  const canManage = useCan("gateways:write")

  if (isLoading) return <Skeleton className="h-96 rounded-2xl" />
  if (error || !data) {
    return (
      <Panel className="p-8 text-center">
        <p className="font-medium">This gateway account does not exist.</p>
        <Button variant="link" asChild>
          <Link href="/apps">Back to apps</Link>
        </Button>
      </Panel>
    )
  }
  const { connection, gateway, products } = data

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild className="-ml-2 text-muted-foreground">
        <Link href="/apps">
          <ArrowLeft /> Apps
        </Link>
      </Button>
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <GatewayMark gatewayId={gateway.id} size="lg" />
            <span>
              {gateway.name} <span className="text-muted-foreground">· {connection.label}</span>
            </span>
          </span>
        }
        description={`Installed ${formatDate(connection.createdAt)}. Last event ${formatRelative(connection.lastEventAt)}.`}
        actions={
          <>
            {connection.sample && <SampleBadge />}
            <Badge variant="outline" className="capitalize">
              <span className={cn("size-1.5 rounded-full", connection.mode === "live" ? "bg-good" : "bg-warning")} />
              {connection.mode}
            </Badge>
            {connection.status === "error" && (
              <Badge variant="outline" className="border-critical/40 text-critical-text">
                Needs attention
              </Badge>
            )}
            {canManage && (
              <Button variant="outline" size="sm" onClick={() => setRotating(true)}>
                <KeyRound /> Rotate keys
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-5">
        <Panel className="lg:col-span-3">
          <PanelHeader title={`Connect your ${gateway.name} dashboard`} description="Paste these into the gateway once. They never change unless you change the base URL in Settings." />
          <div className="p-5">
            <SetupGuide gateway={gateway} connection={connection} />
          </div>
        </Panel>

        <div className="min-w-0 space-y-6 lg:col-span-2">
          <Panel>
            <PanelHeader title="Credentials" description="Secrets are encrypted and only shown masked." />
            <dl className="divide-y px-5 pb-2">
              {gateway.credentialFields.map((f) => (
                <div key={f.key} className="flex items-center justify-between gap-3 py-3 text-sm">
                  <dt className="text-muted-foreground">{f.label}</dt>
                  <dd className="truncate font-mono text-xs">{connection.credentials[f.key] || "—"}</dd>
                </div>
              ))}
            </dl>
          </Panel>

          <Panel>
            <PanelHeader title="Products using this account" description="Each one gets its own callback URL and reference prefix." />
            <div className="p-5 pt-3">
              {products.length ? (
                <ul className="space-y-2">
                  {products.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-2">
                      <Link href={`/products/${p.id}`}>
                        <ProductChip name={p.name} slot={p.colorSlot} />
                      </Link>
                      <code className="font-mono text-xs text-muted-foreground">{p.referencePrefix}_</code>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No products yet.{" "}
                  <Link href="/products/new" className="font-medium text-primary underline-offset-2 hover:underline">
                    Create one
                  </Link>
                </p>
              )}
            </div>
          </Panel>

          {canManage && (
            <Panel className="border-destructive/30">
              <PanelHeader title="Uninstall" description="Stops accepting events from this account. Payment history is kept." />
              <div className="p-5 pt-3">
                <Button variant="destructive" size="sm" onClick={() => setConfirmDelete(true)}>
                  <Trash2 /> Uninstall {connection.label}
                </Button>
              </div>
            </Panel>
          )}
        </div>
      </div>

      {canManage && <RotateDialog open={rotating} onOpenChange={setRotating} gateway={gateway} connection={connection} />}

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Uninstall {gateway.name} · {connection.label}?</DialogTitle>
            <DialogDescription>
              {products.length
                ? `${products.map((p) => p.name).join(", ")} ${products.length > 1 ? "use" : "uses"} this account. They will be detached and fall back to their other gateways, or stop taking payments if they have none.`
                : "No products use this account."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={del.isPending}
              onClick={async () => {
                try {
                  await del.mutateAsync({ id: connection.id, force: true })
                  toast.success(`${gateway.name} account uninstalled`)
                  router.push("/apps")
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Could not uninstall")
                }
              }}
            >
              {del.isPending && <Loader2 className="animate-spin" />}
              Uninstall
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function RotateDialog({
  open,
  onOpenChange,
  gateway,
  connection,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  gateway: GatewayDefinition
  connection: GatewayConnection
}) {
  const update = useUpdateConnection(connection.id)
  const form = useForm<Record<string, string>>({
    resolver: zodResolver(buildCredentialSchema(gateway, connection.mode)) as never,
    defaultValues: Object.fromEntries(gateway.credentialFields.map((f) => [f.key, ""])),
  })
  const submit = form.handleSubmit(async (credentials) => {
    try {
      await update.mutateAsync({ credentials })
      toast.success("Keys rotated. New payments use them right away.")
      form.reset()
      onOpenChange(false)
    } catch (e) {
      if (e instanceof ApiRequestError && e.fields) {
        for (const [k, m] of Object.entries(e.fields)) form.setError(k.replace("credentials.", ""), { message: m })
      } else toast.error("Could not rotate keys")
    }
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>Rotate {gateway.name} keys</DialogTitle>
            <DialogDescription>Paste the new {connection.mode} keys. The webhook URL stays the same.</DialogDescription>
          </DialogHeader>
          <FieldGroup className="my-5 gap-4">
            {gateway.credentialFields.map((f) => (
              <Field key={f.key} data-invalid={!!form.formState.errors[f.key]}>
                <FieldLabel htmlFor={`rot-${f.key}`}>{f.label}</FieldLabel>
                <Input
                  id={`rot-${f.key}`}
                  type={f.type === "secret" ? "password" : "text"}
                  autoComplete="off"
                  className="font-mono text-[13px]"
                  placeholder={f.prefix?.[connection.mode] ? `${f.prefix[connection.mode]}…` : f.placeholder}
                  {...form.register(f.key)}
                />
                <FieldError errors={[form.formState.errors[f.key]]} />
              </Field>
            ))}
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={update.isPending}>
              {update.isPending && <Loader2 className="animate-spin" />}
              Save new keys
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
