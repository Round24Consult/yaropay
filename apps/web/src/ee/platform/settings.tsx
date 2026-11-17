"use client"

// YaroPay Enterprise License: see LICENSE.md in the parent folder.

import type { OperatorSetting } from "@yaropay/core/platform"
import { Loader2 } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"
import { Panel, PanelHeader } from "@/components/shared/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { ApiRequestError } from "@/lib/api/client"
import { useClearOperatorSetting, useOperatorCheck, useOperatorSettings, useSetOperatorSetting } from "./hooks"
import { isCancelled, PlatformShell, useGuarded } from "./platform-shell"

export function PlatformSettingsPage() {
  return (
    <PlatformShell
      title="Platform settings"
      description="Change these here instead of in the server's .env file. A value saved here wins over the server's own; Clear goes back to it. Changes need your password and code, apply at once and are recorded in the audit log."
    >
      <OperatorSettings />
    </PlatformShell>
  )
}

function OperatorSettings() {
  const { data } = useOperatorSettings()
  if (!data) {
    return (
      <div className="grid gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-40 rounded-2xl" />
        ))}
      </div>
    )
  }
  return (
    <div className="grid gap-4">
      {data.settings.map((s) => (
        <SettingCard key={s.key} setting={s} />
      ))}
      <p className="text-sm text-muted-foreground">
        The encryption key, the database, the setup token and the edition stay in the server&apos;s .env: they can&apos;t be changed from the web.
      </p>
    </div>
  )
}

const SOURCE: Record<OperatorSetting["source"], { label: string; variant: "default" | "secondary" | "outline" }> = {
  console: { label: "Saved here", variant: "default" },
  server: { label: "Server setting", variant: "secondary" },
  unset: { label: "Not set", variant: "outline" },
}

const CHECKS: Partial<Record<OperatorSetting["key"], { check: "test-email" | "check-billing-key"; label: string }>> = {
  smtpUrl: { check: "test-email", label: "Send test email" },
  billingPaystackSecretKey: { check: "check-billing-key", label: "Check key" },
}

function SettingCard({ setting }: { setting: OperatorSetting }) {
  const guarded = useGuarded()
  const save = useSetOperatorSetting()
  const clear = useClearOperatorSetting()
  const check = useOperatorCheck()
  const [draft, setDraft] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const source = SOURCE[setting.source]
  const extra = CHECKS[setting.key]
  const current = setting.secret ? (setting.last4 ? `•••• ${setting.last4}` : null) : setting.value

  const onSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!draft.trim()) return
    setError(null)
    try {
      await guarded(() => save.mutateAsync({ key: setting.key, value: setting.key === "v1RateLimitPerMinute" ? Number(draft) : draft }))
      setDraft("")
      toast.success(`${setting.label} saved. It applies now.`)
    } catch (err) {
      if (isCancelled(err)) return
      const message = err instanceof ApiRequestError ? (err.fields?.value ?? err.message) : "Could not save"
      setError(message)
    }
  }

  const onClear = async () => {
    try {
      await guarded(() => clear.mutateAsync(setting.key))
      toast.success(`${setting.label} cleared: the server's value applies again.`)
    } catch (err) {
      if (!isCancelled(err)) toast.error(err instanceof Error ? err.message : "Could not clear")
    }
  }

  const onCheck = async () => {
    if (!extra) return
    try {
      const result = await guarded(() => check.mutateAsync(extra.check))
      if (result.ok) toast.success(result.message)
      else toast.error(result.message)
    } catch (err) {
      if (!isCancelled(err)) toast.error(err instanceof Error ? err.message : "Could not check")
    }
  }

  return (
    <Panel data-testid={`operator-setting-${setting.key}`}>
      <PanelHeader
        title={setting.label}
        description={setting.description}
        actions={
          <Badge variant={source.variant} data-testid={`operator-source-${setting.key}`}>
            {source.label}
          </Badge>
        }
      />
      <div className="grid gap-4 p-5 pt-3">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
          <span>
            <span className="text-muted-foreground">In use: </span>
            <span className="font-mono" data-testid={`operator-current-${setting.key}`}>
              {current ?? "nothing"}
            </span>
          </span>
          <span className="text-muted-foreground">
            Server variable: <code className="font-mono text-xs">{setting.env}</code>
          </span>
        </div>
        <form onSubmit={onSave} className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <Field className="flex-1" data-invalid={error ? true : undefined}>
            <FieldLabel htmlFor={`operator-input-${setting.key}`} className="sr-only">
              New value for {setting.label}
            </FieldLabel>
            <Input
              id={`operator-input-${setting.key}`}
              data-testid={`operator-input-${setting.key}`}
              type={setting.secret ? "password" : setting.key === "v1RateLimitPerMinute" ? "number" : "text"}
              inputMode={setting.key === "v1RateLimitPerMinute" ? "numeric" : undefined}
              autoComplete="off"
              placeholder={setting.secret ? "Paste a new value to replace it" : "New value"}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value)
                setError(null)
              }}
            />
            {error ? <FieldError>{error}</FieldError> : setting.secret && <FieldDescription>Saved values are never shown again, only their last 4 characters.</FieldDescription>}
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={!draft.trim() || save.isPending} data-testid={`operator-save-${setting.key}`}>
              {save.isPending && <Loader2 className="animate-spin" />}
              Save
            </Button>
            {setting.source === "console" && (
              <Button type="button" variant="outline" disabled={clear.isPending} onClick={() => void onClear()} data-testid={`operator-clear-${setting.key}`}>
                Clear
              </Button>
            )}
            {extra && (
              <Button type="button" variant="outline" disabled={check.isPending} onClick={() => void onCheck()} data-testid={`operator-check-${setting.key}`}>
                {check.isPending && <Loader2 className="animate-spin" />}
                {extra.label}
              </Button>
            )}
          </div>
        </form>
      </div>
    </Panel>
  )
}
