"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { PASSWORD_MIN, setupSchema } from "@yaropay/core/auth"
import { Loader2 } from "lucide-react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import * as React from "react"
import { type Resolver, useForm } from "react-hook-form"
import type { z } from "zod"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { useAuthState, useSetup } from "@/lib/api/hooks"
import { applyApiErrors, navigateAfterAuth } from "@/lib/forms"
import { AuthFormSkeleton, AuthHeading } from "./auth-shell"
import { FormAlert } from "./form-alert"
import { PasswordInput } from "./password-input"

type Values = z.infer<typeof setupSchema>

export function SetupForm() {
  const { data: state, isLoading } = useAuthState()
  const setup = useSetup()
  // Internet-facing installs hand out https://…/setup?token=… so only the operator can claim them.
  const linkToken = useSearchParams().get("token") ?? ""
  const [formError, setFormError] = React.useState<string | null>(null)
  const form = useForm<Values>({
    resolver: zodResolver(setupSchema) as Resolver<Values>,
    defaultValues: { name: "", email: "", companyName: "", password: "", setupToken: linkToken },
  })

  if (isLoading) return <AuthFormSkeleton />
  if (state && !state.needsSetup) {
    return (
      <>
        <AuthHeading title="Already set up" description="This install already has an owner. Sign in, or ask an admin for an invite." />
        <Button asChild className="w-full">
          <Link href="/login">Go to sign in</Link>
        </Button>
      </>
    )
  }

  const submit = form.handleSubmit(async (values) => {
    setFormError(null)
    try {
      await setup.mutateAsync(values)
      navigateAfterAuth("/welcome")
    } catch (e) {
      setFormError(applyApiErrors(form, e))
    }
  })

  const errors = form.formState.errors
  // Ask for the token only when the link didn't carry one, or the one it carried was refused.
  const askForToken = Boolean(state?.setupTokenRequired) && (!linkToken || Boolean(errors.setupToken))
  return (
    <>
      <AuthHeading
        title="Set up your install"
        description="Create the owner account. You can invite your team and connect your payment gateway next."
      />
      <form onSubmit={submit} noValidate className="space-y-5">
        <FormAlert>{formError}</FormAlert>
        <FieldGroup className="gap-4">
          {askForToken && (
            <Field data-invalid={!!errors.setupToken}>
              <FieldLabel htmlFor="setupToken">Setup token</FieldLabel>
              <Input id="setupToken" autoComplete="off" spellCheck={false} className="font-mono" {...form.register("setupToken")} />
              {errors.setupToken ? (
                <FieldError errors={[errors.setupToken]} />
              ) : (
                <FieldDescription>This install was started with a setup token. Find SETUP_TOKEN in the server&apos;s .env file.</FieldDescription>
              )}
            </Field>
          )}
          <Field data-invalid={!!errors.companyName}>
            <FieldLabel htmlFor="companyName">Company</FieldLabel>
            <Input id="companyName" autoComplete="organization" autoFocus placeholder="Company A Ltd" {...form.register("companyName")} />
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
            {errors.password ? (
              <FieldError errors={[errors.password]} />
            ) : (
              <FieldDescription>At least {PASSWORD_MIN} characters. A passphrase works well.</FieldDescription>
            )}
          </Field>
        </FieldGroup>
        <Button type="submit" className="w-full" disabled={setup.isPending} data-testid="setup-submit">
          {setup.isPending && <Loader2 className="animate-spin" />}
          Create owner account
        </Button>
      </form>
    </>
  )
}
