"use client"

// YaroPay Enterprise License: see LICENSE.md in the parent folder.

import { Loader2, ShieldAlert } from "lucide-react"
import Link from "next/link"
import * as React from "react"
import { PasswordInput } from "@/components/auth/password-input"
import { PageHeader, Panel } from "@/components/shared/page-header"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { ApiRequestError } from "@/lib/api/client"
import { useReauth } from "@/lib/api/hooks"
import { useMe } from "@/lib/auth"
import { usePlatformOverview } from "./hooks"

type Guarded = <T>(run: () => Promise<T>) => Promise<T>
const ReauthContext = React.createContext<Guarded | null>(null)

/**
 * Runs a change, and if the API says the sign-in is too old, asks for the password and code, then runs
 * it again. Cancelling the dialog rejects with a "Cancelled" error the caller can ignore.
 */
export function useGuarded(): Guarded {
  const ctx = React.useContext(ReauthContext)
  if (!ctx) throw new Error("useGuarded must be used inside <PlatformShell>")
  return ctx
}

export const isCancelled = (e: unknown) => e instanceof Error && e.message === "Cancelled"

/** The platform console frame: access checks, the page header and the re-confirm dialog. (The menu is PlatformSidebar.) */
export function PlatformShell({
  title,
  description,
  actions,
  children,
}: {
  title: string
  description?: string
  actions?: React.ReactNode
  children: React.ReactNode
}) {
  const me = useMe()
  // The overview doubles as the access check: 404 for non-admins, 403 until two-step sign-in is on.
  const probe = usePlatformOverview()
  const pending = React.useRef<{
    resolve: () => void
    reject: (e: Error) => void
  } | null>(null)
  const [asking, setAsking] = React.useState(false)

  const guarded = React.useCallback<Guarded>(async (run) => {
    try {
      return await run()
    } catch (e) {
      if (!(e instanceof ApiRequestError && e.code === "reauth_required")) throw e
      await new Promise<void>((resolve, reject) => {
        pending.current = { resolve, reject }
        setAsking(true)
      })
      return run()
    }
  }, [])

  const notAdmin = me.platformRole !== "super_admin" || (probe.error instanceof ApiRequestError && probe.error.status === 404)
  if (notAdmin) {
    return (
      <Panel className="mx-auto mt-10 max-w-md p-6 text-center">
        <h1 className="text-base font-semibold">Page not found</h1>
        <p className="mt-1 text-sm text-muted-foreground">There&apos;s nothing at this address.</p>
      </Panel>
    )
  }
  if (probe.error instanceof ApiRequestError && probe.error.code === "platform_mfa_required") {
    return (
      <Panel className="mx-auto mt-10 max-w-md p-6 text-center" data-testid="platform-needs-mfa">
        <ShieldAlert className="mx-auto size-8 text-warning-text" aria-hidden />
        <h1 className="mt-3 text-base font-semibold">Turn on two-step sign-in first</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The platform console shows every company on YaroPay, so it needs a code from your authenticator app as well as your password. Turn it on, then sign in
          again.
        </p>
        <Button asChild size="sm" className="mt-4">
          <Link href="/settings?tab=security">Set up two-step sign-in</Link>
        </Button>
      </Panel>
    )
  }

  return (
    <ReauthContext.Provider value={guarded}>
      <div className="space-y-6">
        <PageHeader title={title} description={description} actions={actions} />
        {probe.isLoading ? <Skeleton className="h-40" /> : children}
      </div>
      <ReauthDialog
        open={asking}
        onDone={() => {
          setAsking(false)
          pending.current?.resolve()
          pending.current = null
        }}
        onCancel={() => {
          setAsking(false)
          pending.current?.reject(new Error("Cancelled"))
          pending.current = null
        }}
      />
    </ReauthContext.Provider>
  )
}

function ReauthDialog({ open, onDone, onCancel }: { open: boolean; onDone: () => void; onCancel: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      {/* The form mounts with the dialog, so every opening starts with empty fields. */}
      <DialogContent className="sm:max-w-sm">{open && <ReauthForm onDone={onDone} onCancel={onCancel} />}</DialogContent>
    </Dialog>
  )
}

function ReauthForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const reauth = useReauth()
  const [password, setPassword] = React.useState("")
  const [code, setCode] = React.useState("")
  const [errors, setErrors] = React.useState<{
    password?: string
    code?: string
  }>({})
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault()
        setErrors({})
        try {
          await reauth.mutateAsync({ password, code })
          onDone()
        } catch (err) {
          if (err instanceof ApiRequestError && err.fields) setErrors({ password: err.fields.password, code: err.fields.code })
          else
            setErrors({
              password: err instanceof Error ? err.message : "Could not confirm",
            })
        }
      }}
      noValidate
      className="space-y-4"
    >
      <DialogHeader>
        <DialogTitle>Confirm it&apos;s you</DialogTitle>
        <DialogDescription>Changes in the platform console need your password and a code from the last 15 minutes.</DialogDescription>
      </DialogHeader>
      <Field data-invalid={!!errors.password}>
        <FieldLabel htmlFor="reauth-password">Password</FieldLabel>
        <PasswordInput
          id="reauth-password"
          autoComplete="current-password"
          autoFocus
          invalid={!!errors.password}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {errors.password && <FieldError errors={[{ message: errors.password }]} />}
      </Field>
      <Field data-invalid={!!errors.code}>
        <FieldLabel htmlFor="reauth-code">Code from your app</FieldLabel>
        <Input
          id="reauth-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          className="font-mono tracking-[0.3em]"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          data-testid="reauth-code"
        />
        {errors.code && <FieldError errors={[{ message: errors.code }]} />}
      </Field>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={reauth.isPending || !password || code.length !== 6} data-testid="reauth-submit">
          {reauth.isPending && <Loader2 className="animate-spin" />}
          Confirm
        </Button>
      </DialogFooter>
    </form>
  )
}
