"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { forgotPasswordSchema } from "@yaropay/core/auth"
import { ArrowLeft, Loader2, MailCheck } from "lucide-react"
import Link from "next/link"
import * as React from "react"
import { type Resolver, useForm } from "react-hook-form"
import type { z } from "zod"
import { Button } from "@/components/ui/button"
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { useAuthState, useForgotPassword } from "@/lib/api/hooks"
import { applyApiErrors } from "@/lib/forms"
import { AuthHeading } from "./auth-shell"
import { FormAlert } from "./form-alert"

type Values = z.infer<typeof forgotPasswordSchema>

export function ForgotForm() {
  const forgot = useForgotPassword()
  const { data: state } = useAuthState()
  const [sentTo, setSentTo] = React.useState<string | null>(null)
  const [formError, setFormError] = React.useState<string | null>(null)
  const form = useForm<Values>({
    resolver: zodResolver(forgotPasswordSchema) as Resolver<Values>,
    defaultValues: { email: "" },
  })

  const submit = form.handleSubmit(async (values) => {
    setFormError(null)
    try {
      await forgot.mutateAsync(values)
      setSentTo(values.email)
    } catch (e) {
      setFormError(applyApiErrors(form, e))
    }
  })

  if (sentTo) {
    return (
      <>
        <span className="mb-5 grid size-11 place-items-center rounded-xl bg-primary/10 text-primary">
          <MailCheck className="size-5" aria-hidden />
        </span>
        <AuthHeading
          title="Check your inbox"
          description={
            <>
              If <span className="font-medium text-foreground">{sentTo}</span> has an account, a reset link is on its way. It
              expires in one hour.
            </>
          }
        />
        <BackToSignIn />
      </>
    )
  }

  const errors = form.formState.errors
  return (
    <>
      <AuthHeading title="Reset your password" description="Enter your email and we'll send you a link to choose a new password." />
      <form onSubmit={submit} noValidate className="space-y-5">
        <FormAlert>{formError}</FormAlert>
        {state && !state.emailEnabled && (
          <FormAlert tone="info">This install can&apos;t send email yet. Ask the owner to configure SMTP, or to invite you again.</FormAlert>
        )}
        <FieldGroup>
          <Field data-invalid={!!errors.email}>
            <FieldLabel htmlFor="email">Email</FieldLabel>
            <Input id="email" type="email" autoComplete="email" autoFocus {...form.register("email")} />
            <FieldError errors={[errors.email]} />
          </Field>
        </FieldGroup>
        <Button type="submit" className="w-full" disabled={forgot.isPending}>
          {forgot.isPending && <Loader2 className="animate-spin" />}
          Send reset link
        </Button>
      </form>
      <BackToSignIn className="mt-6" />
    </>
  )
}

export function BackToSignIn({ className }: { className?: string }) {
  return (
    <Button variant="ghost" size="sm" asChild className={className}>
      <Link href="/login">
        <ArrowLeft /> Back to sign in
      </Link>
    </Button>
  )
}
