"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { loginSchema, TRUSTED_BROWSER_DAYS } from "@yaropay/core/auth"
import { Loader2 } from "lucide-react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import * as React from "react"
import { type Resolver, useForm } from "react-hook-form"
import type { z } from "zod"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { ApiRequestError } from "@/lib/api/client"
import { useAuthState, useLogin, useLogout, useMeQuery, useVerifyMfa } from "@/lib/api/hooks"
import { applyApiErrors, navigateAfterAuth, safeNext } from "@/lib/forms"
import { AuthHeading } from "./auth-shell"
import { CheckYourEmail } from "@/ee/signup"
import { FormAlert } from "./form-alert"
import { PasswordInput } from "./password-input"

type Values = z.infer<typeof loginSchema>

export function LoginForm() {
  const router = useRouter()
  const search = useSearchParams()
  const next = safeNext(search.get("next"))
  const { data: state } = useAuthState()
  const { data: me, error: meError } = useMeQuery()
  const login = useLogin()
  const [formError, setFormError] = React.useState<string | null>(null)
  // A session that got the password right but still owes its authenticator code (also after a reload).
  const [codeStep, setCodeStep] = React.useState(false)
  // A Cloud sign-up that hasn't confirmed its email yet.
  const [unconfirmed, setUnconfirmed] = React.useState<string | null>(null)
  const pending = codeStep || (meError instanceof ApiRequestError && meError.code === "mfa_required")
  const form = useForm<Values>({
    resolver: zodResolver(loginSchema) as Resolver<Values>,
    defaultValues: { email: "", password: "" },
  })

  React.useEffect(() => {
    if (state?.needsSetup) router.replace("/setup")
    else if (me) navigateAfterAuth(next)
  }, [state?.needsSetup, me, next, router])

  const submit = form.handleSubmit(async (values) => {
    setFormError(null)
    try {
      const result = await login.mutateAsync(values)
      if ("mfaRequired" in result) setCodeStep(true)
      else navigateAfterAuth(next)
    } catch (e) {
      if (e instanceof ApiRequestError && e.code === "email_unverified") {
        setUnconfirmed(values.email.trim().toLowerCase())
      } else if (e instanceof ApiRequestError && e.status === 401) {
        setFormError("That email and password don't match an account.")
        form.setFocus("password")
      } else setFormError(applyApiErrors(form, e))
    }
  })

  if (pending) return <CodeStep next={next} onStartOver={() => setCodeStep(false)} />
  if (unconfirmed) return <CheckYourEmail email={unconfirmed} />

  const errors = form.formState.errors
  return (
    <>
      <AuthHeading title="Sign in" description="Welcome back. Sign in to manage your products and payments." />
      <form onSubmit={submit} noValidate className="space-y-5">
        <FormAlert>{formError}</FormAlert>
        <FieldGroup className="gap-4">
          <Field data-invalid={!!errors.email}>
            <FieldLabel htmlFor="email">Email</FieldLabel>
            <Input id="email" type="email" autoComplete="email" autoFocus aria-invalid={!!errors.email} {...form.register("email")} />
            <FieldError errors={[errors.email]} />
          </Field>
          <Field data-invalid={!!errors.password}>
            <div className="flex items-center justify-between">
              <FieldLabel htmlFor="password">Password</FieldLabel>
              <Link href="/forgot-password" className="text-xs font-medium text-primary underline-offset-2 hover:underline">
                Forgot password?
              </Link>
            </div>
            <PasswordInput id="password" autoComplete="current-password" invalid={!!errors.password} {...form.register("password")} />
            <FieldError errors={[errors.password]} />
          </Field>
        </FieldGroup>
        <Button type="submit" className="w-full" disabled={login.isPending} data-testid="login-submit">
          {login.isPending && <Loader2 className="animate-spin" />}
          Sign in
        </Button>
      </form>
      <p className="mt-6 text-center text-xs text-muted-foreground">
        {state?.signupEnabled ? (
          <>
            New to YaroPay?{" "}
            <Link href="/signup" className="font-medium text-primary underline-offset-2 hover:underline" data-testid="signup-link">
              Create an account
            </Link>
          </>
        ) : (
          "New here? Ask an owner or admin of this install to invite you."
        )}
      </p>
    </>
  )
}

/** The second step: a code from the authenticator app, or one of the recovery codes. */
function CodeStep({ next, onStartOver }: { next: string; onStartOver: () => void }) {
  const verify = useVerifyMfa()
  const logout = useLogout()
  const [recovery, setRecovery] = React.useState(false)
  const [code, setCode] = React.useState("")
  const [trustBrowser, setTrustBrowser] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const inputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => inputRef.current?.focus(), [recovery])

  const startOver = async () => {
    await logout.mutateAsync().catch(() => undefined)
    onStartOver()
    window.location.replace(next === "/" ? "/login" : `/login?next=${encodeURIComponent(next)}`)
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    try {
      await verify.mutateAsync({ code, trustBrowser })
      navigateAfterAuth(next)
    } catch (err) {
      if (err instanceof ApiRequestError && (err.code === "mfa_locked" || err.status === 401)) {
        setError(err.code === "mfa_locked" ? "Too many wrong codes. Sign in with your password again." : "Your sign-in timed out. Sign in again.")
        setTimeout(() => void startOver(), 2500)
        return
      }
      setError(err instanceof ApiRequestError ? (err.fields?.code ?? err.message) : "Something went wrong. Try again.")
      setCode("")
      inputRef.current?.focus()
    }
  }

  return (
    <>
      <AuthHeading
        title="Two-step sign-in"
        description={recovery ? "Enter one of the recovery codes you saved when you turned on two-step sign-in." : "Open your authenticator app and enter the 6-digit code for this account."}
      />
      <form onSubmit={submit} noValidate className="space-y-5">
        <FormAlert>{error}</FormAlert>
        <Field data-invalid={!!error}>
          <FieldLabel htmlFor="mfa-code">{recovery ? "Recovery code" : "Code"}</FieldLabel>
          {recovery ? (
            <Input
              ref={inputRef}
              id="mfa-code"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="xxxx-xxxx-xx"
              className="font-mono"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              data-testid="mfa-code"
            />
          ) : (
            <Input
              ref={inputRef}
              id="mfa-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="123456"
              className="font-mono tracking-[0.3em]"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              data-testid="mfa-code"
            />
          )}
        </Field>
        <Field orientation="horizontal" className="items-start gap-2.5">
          <Checkbox id="trust-browser" checked={trustBrowser} onCheckedChange={(v) => setTrustBrowser(v === true)} className="mt-0.5" data-testid="trust-browser" />
          <div className="grid gap-1">
            <FieldLabel htmlFor="trust-browser" className="font-normal">
              Trust this browser for {TRUSTED_BROWSER_DAYS} days
            </FieldLabel>
            <p className="text-xs text-muted-foreground">You&apos;ll still enter your password. Don&apos;t tick this on a shared or public computer.</p>
          </div>
        </Field>
        <Button type="submit" className="w-full" disabled={verify.isPending || code.trim().length < 6} data-testid="mfa-submit">
          {verify.isPending && <Loader2 className="animate-spin" />}
          Continue
        </Button>
      </form>
      <div className="mt-6 flex items-center justify-between text-xs">
        <button
          type="button"
          className="font-medium text-primary underline-offset-2 hover:underline"
          onClick={() => {
            setRecovery((r) => !r)
            setCode("")
            setError(null)
          }}
        >
          {recovery ? "Use the authenticator app" : "Use a recovery code"}
        </button>
        <button type="button" className="text-muted-foreground underline-offset-2 hover:underline" onClick={() => void startOver()}>
          Start over
        </button>
      </div>
    </>
  )
}
