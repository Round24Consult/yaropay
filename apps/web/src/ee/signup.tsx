"use client"

// YaroPay Enterprise License: see LICENSE.md in this folder.

import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation } from "@tanstack/react-query"
import { PASSWORD_MIN, type SessionUser, signupSchema } from "@yaropay/core/auth"
import { Loader2, MailCheck } from "lucide-react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import * as React from "react"
import { Controller, type Resolver, useForm } from "react-hook-form"
import type { z } from "zod"
import { AuthFormSkeleton, AuthHeading } from "@/components/auth/auth-shell"
import { FormAlert } from "@/components/auth/form-alert"
import { PasswordInput } from "@/components/auth/password-input"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { api, ApiRequestError } from "@/lib/api/client"
import { useAuthState } from "@/lib/api/hooks"
import { applyApiErrors, navigateAfterAuth } from "@/lib/forms"

type Values = z.input<typeof signupSchema>

export function useResendVerification() {
  return useMutation({ mutationFn: (email: string) => api<{ sent: true }>("/auth/verify-email/resend", { method: "POST", json: { email } }) })
}

/** YaroPay Cloud: create a company and its owner account. */
export function SignupForm() {
  const { data: state, isLoading } = useAuthState()
  const [sentTo, setSentTo] = React.useState<string | null>(null)
  const [formError, setFormError] = React.useState<string | null>(null)
  const signup = useMutation({ mutationFn: (input: Values) => api<{ sent: true }>("/auth/signup", { method: "POST", json: input }) })
  const form = useForm<Values>({
    resolver: zodResolver(signupSchema) as Resolver<Values>,
    defaultValues: { name: "", email: "", password: "", companyName: "", currency: "NGN" },
  })

  if (isLoading) return <AuthFormSkeleton />
  if (sentTo) return <CheckYourEmail email={sentTo} />
  if (!state?.signupEnabled) {
    return (
      <>
        <AuthHeading title="Sign-ups aren't open yet" description="YaroPay Cloud is opening to new companies soon. Already have an account?" />
        <Button asChild className="w-full">
          <Link href="/login">Sign in</Link>
        </Button>
      </>
    )
  }

  const submit = form.handleSubmit(async (values) => {
    setFormError(null)
    try {
      await signup.mutateAsync(values)
      setSentTo(values.email.trim().toLowerCase())
    } catch (e) {
      setFormError(applyApiErrors(form, e))
    }
  })
  const errors = form.formState.errors
  return (
    <>
      <AuthHeading title="Create your company" description="Test mode is free. Your free trial starts with your first live payment." />
      <form onSubmit={submit} noValidate className="space-y-5">
        <FormAlert>{formError}</FormAlert>
        <FieldGroup className="gap-4">
          <Field data-invalid={!!errors.companyName}>
            <FieldLabel htmlFor="companyName">Company</FieldLabel>
            <Input id="companyName" autoComplete="organization" autoFocus {...form.register("companyName")} />
            <FieldError errors={[errors.companyName]} />
          </Field>
          <Field data-invalid={!!errors.name}>
            <FieldLabel htmlFor="name">Your name</FieldLabel>
            <Input id="name" autoComplete="name" {...form.register("name")} />
            <FieldError errors={[errors.name]} />
          </Field>
          <Field data-invalid={!!errors.email}>
            <FieldLabel htmlFor="email">Work email</FieldLabel>
            <Input id="email" type="email" autoComplete="email" {...form.register("email")} />
            <FieldError errors={[errors.email]} />
          </Field>
          <Field data-invalid={!!errors.password}>
            <FieldLabel htmlFor="password">Password</FieldLabel>
            <PasswordInput id="password" autoComplete="new-password" invalid={!!errors.password} {...form.register("password")} />
            {errors.password ? <FieldError errors={[errors.password]} /> : <FieldDescription>At least {PASSWORD_MIN} characters.</FieldDescription>}
          </Field>
          <Field>
            <FieldLabel>Pay YaroPay in</FieldLabel>
            <Controller
              control={form.control}
              name="currency"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger aria-label="Billing currency">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NGN">Naira (NGN)</SelectItem>
                    <SelectItem value="USD">US dollars (USD)</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
            <FieldDescription>Your customers can still pay in any currency your gateway supports.</FieldDescription>
          </Field>
        </FieldGroup>
        <Button type="submit" className="w-full" disabled={signup.isPending} data-testid="signup-submit">
          {signup.isPending && <Loader2 className="animate-spin" />}
          Create account
        </Button>
      </form>
      <p className="mt-6 text-center text-xs text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-primary underline-offset-2 hover:underline">
          Sign in
        </Link>
      </p>
    </>
  )
}

/** After signing up, or when signing in with an address that isn't confirmed yet. */
export function CheckYourEmail({ email }: { email: string }) {
  const resend = useResendVerification()
  const [resent, setResent] = React.useState(false)
  return (
    <>
      <div className="mb-4 grid size-11 place-items-center rounded-xl bg-primary/10 text-primary">
        <MailCheck className="size-5" aria-hidden />
      </div>
      <AuthHeading title="Check your email" description={`We sent a link to ${email}. Open it to confirm your address and sign in. It works for 24 hours.`} />
      <div className="space-y-3 text-sm text-muted-foreground">
        <p>Nothing there? Look in spam, or send it again.</p>
        <Button
          variant="outline"
          className="w-full"
          disabled={resend.isPending || resent}
          onClick={async () => {
            await resend.mutateAsync(email).catch(() => undefined)
            setResent(true)
          }}
          data-testid="resend-link"
        >
          {resend.isPending && <Loader2 className="animate-spin" />}
          {resent ? "Sent again" : "Send the link again"}
        </Button>
      </div>
    </>
  )
}

/** The link from the confirmation email. */
export function VerifyEmail() {
  const token = useSearchParams().get("token") ?? ""
  const verify = useMutation({ mutationFn: () => api<{ user: SessionUser }>("/auth/verify-email", { method: "POST", json: { token } }) })
  const started = React.useRef(false)
  const { mutate } = verify

  React.useEffect(() => {
    if (started.current || !token) return
    started.current = true
    mutate(undefined, { onSuccess: () => navigateAfterAuth("/welcome") })
  }, [token, mutate])

  if (!token || verify.isError) {
    const expired = verify.error instanceof ApiRequestError && verify.error.status === 410
    return (
      <>
        <AuthHeading
          title={expired || !token ? "This link doesn't work any more" : "Couldn't confirm your email"}
          description={expired || !token ? "It may have expired or been used already. Sign in, and if your address still needs confirming we'll offer a new link." : verify.error?.message}
        />
        <Button asChild className="w-full">
          <Link href="/login">Go to sign in</Link>
        </Button>
      </>
    )
  }
  return (
    <div className="flex items-center gap-3 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" aria-hidden /> Confirming your email…
    </div>
  )
}
