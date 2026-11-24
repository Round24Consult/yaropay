"use client"

// YaroPay Enterprise License: see LICENSE.md in the ee folder.

import type { McpConsentRequest } from "@yaropay/core/mcp"
import { AlertTriangle, ArrowRight, Check, Loader2, ShieldCheck } from "lucide-react"
import { useSearchParams } from "next/navigation"
import * as React from "react"
import { PasswordInput } from "@/components/auth/password-input"
import { BrandMark } from "@/components/shared/brand-mark"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { ApiRequestError } from "@/lib/api/client"
import { useReauth } from "@/lib/api/hooks"
import { useMe } from "@/lib/auth"
import { useApproveMcpConsent, useDenyMcpConsent, useMcpConsent } from "./hooks"

/** /connect/authorize: an AI app asks to connect; the member picks the company and approves or denies. */
export function ConsentScreen() {
  const id = useSearchParams().get("request")
  const { data, error, isLoading } = useMcpConsent(id)
  return (
    <main className="mx-auto w-full max-w-md px-4 py-12 sm:py-20">
      <div className="mb-6 flex items-center gap-2.5">
        <BrandMark />
        <span className="text-sm font-semibold">YaroPay</span>
      </div>
      {!id || error ? (
        <Problem error={error} />
      ) : isLoading || !data ? (
        <Skeleton className="h-96 rounded-2xl" />
      ) : (
        <Consent request={data} />
      )}
    </main>
  )
}

function Problem({ error }: { error: Error | null }) {
  const expired = error instanceof ApiRequestError && error.status === 410
  return (
    <Alert variant="destructive" data-testid="consent-problem">
      <AlertTriangle />
      <AlertTitle>{expired ? "This sign-in has expired" : "This sign-in link isn't valid"}</AlertTitle>
      <AlertDescription>{expired ? error.message : "Start again from the AI app you were connecting."}</AlertDescription>
    </Alert>
  )
}

function Consent({ request }: { request: McpConsentRequest }) {
  const me = useMe()
  const approve = useApproveMcpConsent(request.id)
  const deny = useDenyMcpConsent(request.id)
  const reauth = useReauth()
  const firstAvailable = request.companies.find((c) => c.current && c.available) ?? request.companies.find((c) => c.available)
  const [companyId, setCompanyId] = React.useState(firstAvailable?.id ?? "")
  const [live, setLive] = React.useState(false)
  const [actions, setActions] = React.useState(true)
  const [needsReauth, setNeedsReauth] = React.useState(false)
  const [password, setPassword] = React.useState("")
  const [code, setCode] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [leaving, setLeaving] = React.useState(false)
  const company = request.companies.find((c) => c.id === companyId)
  const { client, redirect } = request

  async function onApprove(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      if (needsReauth) await reauth.mutateAsync({ password, code })
      const { redirectUrl } = await approve.mutateAsync({ workspaceId: companyId, live: live && !!company?.liveAvailable, actions: actions && !!company?.actionsAvailable })
      setLeaving(true)
      window.location.assign(redirectUrl)
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === "reauth_required") setNeedsReauth(true)
      setError((err as Error).message)
    }
  }

  async function onDeny() {
    setError(null)
    try {
      const { redirectUrl } = await deny.mutateAsync()
      setLeaving(true)
      window.location.assign(redirectUrl)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const busy = approve.isPending || deny.isPending || reauth.isPending || leaving
  return (
    <form onSubmit={onApprove} className="space-y-5 rounded-2xl border bg-card p-6 shadow-card" data-testid="consent">
      <div className="space-y-1.5">
        <h1 className="text-lg font-semibold text-balance">
          {client.name} wants to connect to YaroPay
        </h1>
        <p className="text-sm text-muted-foreground">
          Signed in as {me.name} ({me.email}).
        </p>
      </div>

      <dl className="space-y-2 rounded-xl bg-muted/50 p-3 text-sm">
        <div className="flex gap-2">
          <dt className="w-24 shrink-0 text-muted-foreground">App</dt>
          <dd className="min-w-0">
            {client.host ? (
              <>
                Details published at <span className="font-medium break-all">{client.host}</span>
              </>
            ) : (
              <>
                Registered itself with this name <Badge variant="outline">Not verified</Badge>
              </>
            )}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-24 shrink-0 text-muted-foreground">Sends you to</dt>
          <dd className="min-w-0 font-medium break-all" data-testid="consent-redirect">
            {redirect.host}
          </dd>
        </div>
      </dl>

      {request.companies.length > 1 ? (
        <div className="space-y-2">
          <p className="text-sm font-medium">Connect to</p>
          <RadioGroup value={companyId} onValueChange={setCompanyId}>
            {request.companies.map((c) => (
              <Label key={c.id} className="flex items-start gap-3 rounded-lg border p-3 font-normal has-[button:disabled]:opacity-60" htmlFor={`company-${c.id}`}>
                <RadioGroupItem id={`company-${c.id}`} value={c.id} disabled={!c.available} className="mt-0.5" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{c.name}</span>
                  <span className="block text-xs text-muted-foreground">{c.available ? `As ${c.role}` : c.reason}</span>
                </span>
              </Label>
            ))}
          </RadioGroup>
        </div>
      ) : company && !company.available ? (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>{"AI apps can't be used in " + company.name}</AlertTitle>
          <AlertDescription>{company.reason}</AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-2">
        <p className="text-sm font-medium">{client.name} will be able to</p>
        <ul className="space-y-1.5 text-sm text-muted-foreground">
          {[
            "Read your products, payments, analytics, gateway accounts, webhooks and audit log, as far as your role allows",
            "See customers' emails masked and names as initials, unless your company shares them",
          ].map((line) => (
            <li key={line} className="flex gap-2">
              <Check className="mt-0.5 size-4 shrink-0 text-good" aria-hidden />
              {line}
            </li>
          ))}
          <li className="flex gap-2">
            <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
            Never see gateway keys, API keys or signing secrets
          </li>
        </ul>
      </div>

      {company?.actionsAvailable && (
        <div className="flex items-start gap-3 rounded-lg border p-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Ask for actions</p>
            <p className="text-xs text-muted-foreground">
              Re-check a payment, retry a webhook or create a payment link. Each one waits for you to approve it in YaroPay.
            </p>
          </div>
          <Switch checked={actions} onCheckedChange={setActions} disabled={busy} aria-label="Ask for actions" data-testid="consent-actions" />
        </div>
      )}

      <div className="flex items-start gap-3 rounded-lg border p-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Live data too</p>
          <p className="text-xs text-muted-foreground">
            {company?.liveAvailable
              ? "Real payments as well as test ones. You'll confirm with your password and code."
              : request.mfaEnabled
                ? "This company keeps AI apps to test data."
                : "Turn on two-step sign-in to allow live data. Test data only for now."}
          </p>
        </div>
        <Switch checked={live} onCheckedChange={setLive} disabled={!company?.liveAvailable || busy} aria-label="Live data too" data-testid="consent-live" />
      </div>

      {needsReauth && (
        <div className="space-y-3 rounded-lg border p-3">
          <Field>
            <FieldLabel htmlFor="consent-password">Password</FieldLabel>
            <PasswordInput id="consent-password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          </Field>
          <Field>
            <FieldLabel htmlFor="consent-code">Authenticator code</FieldLabel>
            <Input id="consent-code" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" required />
          </Field>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={onDeny} disabled={busy} data-testid="consent-deny">
          Deny
        </Button>
        <Button type="submit" disabled={busy || !company?.available} data-testid="consent-approve">
          {busy ? <Loader2 className="animate-spin" /> : null}
          Approve <ArrowRight />
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        You can disconnect {client.name} any time in Settings → AI apps. The connection ends after 90 days, and whenever you change your password.
      </p>
    </form>
  )
}
