"use client"

// YaroPay Enterprise License: see LICENSE.md in the ee folder.

import type { McpApproval } from "@yaropay/core/mcp"
import { AlertTriangle, Check, Clock, Loader2, X } from "lucide-react"
import * as React from "react"
import { PasswordInput } from "@/components/auth/password-input"
import { BrandMark } from "@/components/shared/brand-mark"
import { CopyField } from "@/components/shared/copy-field"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { ApiRequestError } from "@/lib/api/client"
import { useReauth } from "@/lib/api/hooks"
import { useDecideMcpApproval, useMcpApproval } from "./hooks"

function minutesLeft(iso: string): string {
  const m = Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 60_000))
  return m <= 1 ? "in about a minute" : `in ${m} minutes`
}

/** /connect/approve/[id]: the member approves (or denies) one action an AI app asked for. */
export function ApprovalScreen({ id }: { id: string }) {
  const { data, error, isLoading } = useMcpApproval(id)
  return (
    <main className="mx-auto w-full max-w-md px-4 py-12 sm:py-20">
      <div className="mb-6 flex items-center gap-2.5">
        <BrandMark />
        <span className="text-sm font-semibold">YaroPay</span>
      </div>
      {error ? (
        <Alert variant="destructive" data-testid="approval-problem">
          <AlertTriangle />
          <AlertTitle>{"This action isn't here"}</AlertTitle>
          <AlertDescription>
            {error instanceof ApiRequestError && error.status === 404
              ? "It belongs to someone else, or the link is wrong. Only the person whose AI app asked can approve it."
              : error.message}
          </AlertDescription>
        </Alert>
      ) : isLoading || !data ? (
        <Skeleton className="h-96 rounded-2xl" />
      ) : (
        <Approval approval={data} />
      )}
    </main>
  )
}

function Approval({ approval }: { approval: McpApproval }) {
  const decide = useDecideMcpApproval(approval.id)
  const reauth = useReauth()
  const [needsReauth, setNeedsReauth] = React.useState(false)
  const [password, setPassword] = React.useState("")
  const [code, setCode] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const live = approval.mode === "live"

  async function onApprove(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      if (needsReauth) await reauth.mutateAsync({ password, code })
      await decide.mutateAsync("approve")
      setNeedsReauth(false)
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === "reauth_required") setNeedsReauth(true)
      setError((err as Error).message)
    }
  }

  const busy = decide.isPending || reauth.isPending
  return (
    <form onSubmit={onApprove} className="space-y-5 rounded-2xl border bg-card p-6 shadow-card" data-testid="approval" data-status={approval.status}>
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <Badge variant={live ? "destructive" : "secondary"} data-testid="approval-mode">
            {live ? "LIVE" : "TEST"}
          </Badge>
          <span className="text-xs text-muted-foreground">
            {approval.client} · {approval.company}
          </span>
        </div>
        <h1 className="text-lg font-semibold text-balance">
          {approval.client} wants to {approval.title.charAt(0).toLowerCase() + approval.title.slice(1)}
        </h1>
      </div>

      <dl className="divide-y rounded-xl border text-sm">
        {approval.details.map((d) => (
          <div key={d.label} className="flex gap-3 px-3 py-2">
            <dt className="w-28 shrink-0 text-muted-foreground">{d.label}</dt>
            <dd className="min-w-0 break-words font-medium">{d.value}</dd>
          </div>
        ))}
      </dl>

      {approval.status === "pending" && (
        <>
          {live && (
            <p className="text-sm text-muted-foreground">
              {"This uses live data, so YaroPay asks for your password and code again if you haven't entered them in the last 15 minutes."}
            </p>
          )}
          {needsReauth && (
            <div className="space-y-3 rounded-lg border p-3">
              <Field>
                <FieldLabel htmlFor="approval-password">Password</FieldLabel>
                <PasswordInput id="approval-password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
              </Field>
              <Field>
                <FieldLabel htmlFor="approval-code">Authenticator code</FieldLabel>
                <Input id="approval-code" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" required />
              </Field>
            </div>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" disabled={busy} onClick={() => decide.mutate("deny", { onError: (e) => setError(e.message) })} data-testid="approval-deny">
              Deny
            </Button>
            <Button type="submit" disabled={busy} data-testid="approval-approve">
              {busy && <Loader2 className="animate-spin" />} Approve
            </Button>
          </div>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="size-3.5" aria-hidden /> Expires {minutesLeft(approval.expiresAt)}. Nothing happens unless you approve.
          </p>
        </>
      )}

      {approval.status === "succeeded" && approval.result && (
        <div className="space-y-3" data-testid="approval-result">
          <Alert>
            <Check />
            <AlertTitle>Done</AlertTitle>
            <AlertDescription>{approval.result.summary}</AlertDescription>
          </Alert>
          {approval.result.link && <CopyField label="Checkout link" value={approval.result.link} testId="approval-link" />}
          <p className="text-sm text-muted-foreground">Go back to {approval.client} and tell it you approved: it can fetch the result now.</p>
        </div>
      )}
      {approval.status === "failed" && (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>Approved, but it failed</AlertTitle>
          <AlertDescription>{approval.error}</AlertDescription>
        </Alert>
      )}
      {approval.status === "denied" && (
        <Alert>
          <X />
          <AlertTitle>Denied</AlertTitle>
          <AlertDescription>Nothing happened. {approval.client} has been told.</AlertDescription>
        </Alert>
      )}
      {approval.status === "expired" && (
        <Alert>
          <Clock />
          <AlertTitle>Expired</AlertTitle>
          <AlertDescription>Nobody approved this in time, so nothing happened. Ask {approval.client} again if you still want it.</AlertDescription>
        </Alert>
      )}
      {approval.status === "executing" && <p className="text-sm text-muted-foreground">Running now…</p>}
    </form>
  )
}
