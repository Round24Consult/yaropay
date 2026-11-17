"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { PASSWORD_MIN, passwordSchema } from "@yaropay/core/auth"
import { CircleCheck, Loader2 } from "lucide-react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import * as React from "react"
import { type Resolver, useForm } from "react-hook-form"
import { z } from "zod"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { ApiRequestError } from "@/lib/api/client"
import { useResetPassword } from "@/lib/api/hooks"
import { applyApiErrors } from "@/lib/forms"
import { AuthHeading } from "./auth-shell"
import { BackToSignIn } from "./forgot-form"
import { FormAlert } from "./form-alert"
import { PasswordInput } from "./password-input"

const schema = z.object({ password: passwordSchema })
type Values = z.infer<typeof schema>

export function ResetForm() {
  const token = useSearchParams().get("token") ?? ""
  const reset = useResetPassword()
  const [done, setDone] = React.useState(false)
  const [formError, setFormError] = React.useState<string | null>(null)
  const form = useForm<Values>({ resolver: zodResolver(schema) as Resolver<Values>, defaultValues: { password: "" } })

  if (!token) {
    return (
      <>
        <AuthHeading title="This link is incomplete" description="Open the reset link from your email again, or request a new one." />
        <Button asChild className="w-full">
          <Link href="/forgot-password">Request a new link</Link>
        </Button>
      </>
    )
  }

  if (done) {
    return (
      <>
        <span className="mb-5 grid size-11 place-items-center rounded-xl bg-good/10 text-good-text">
          <CircleCheck className="size-5" aria-hidden />
        </span>
        <AuthHeading title="Password updated" description="You've been signed out everywhere else. Sign in with your new password." />
        <Button asChild className="w-full">
          <Link href="/login">Sign in</Link>
        </Button>
      </>
    )
  }

  const submit = form.handleSubmit(async ({ password }) => {
    setFormError(null)
    try {
      await reset.mutateAsync({ token, password })
      setDone(true)
    } catch (e) {
      if (e instanceof ApiRequestError && (e.status === 400 || e.status === 404 || e.status === 410) && !e.fields?.password) {
        setFormError("This reset link has expired or was already used. Request a new one.")
      } else setFormError(applyApiErrors(form, e))
    }
  })

  const errors = form.formState.errors
  return (
    <>
      <AuthHeading title="Choose a new password" description="Pick something you don't use anywhere else." />
      <form onSubmit={submit} noValidate className="space-y-5">
        <FormAlert>{formError}</FormAlert>
        <FieldGroup>
          <Field data-invalid={!!errors.password}>
            <FieldLabel htmlFor="password">New password</FieldLabel>
            <PasswordInput id="password" autoComplete="new-password" autoFocus invalid={!!errors.password} {...form.register("password")} />
            {errors.password ? (
              <FieldError errors={[errors.password]} />
            ) : (
              <FieldDescription>At least {PASSWORD_MIN} characters.</FieldDescription>
            )}
          </Field>
        </FieldGroup>
        <Button type="submit" className="w-full" disabled={reset.isPending}>
          {reset.isPending && <Loader2 className="animate-spin" />}
          Update password
        </Button>
      </form>
      <BackToSignIn className="mt-6" />
    </>
  )
}
