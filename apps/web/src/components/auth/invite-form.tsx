"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { acceptInviteSchema, joinInviteSchema, PASSWORD_MIN, ROLES } from "@yaropay/core/auth"
import { Loader2, UserPlus } from "lucide-react"
import Link from "next/link"
import * as React from "react"
import { type Resolver, useForm } from "react-hook-form"
import type { z } from "zod"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { ApiRequestError } from "@/lib/api/client"
import { useAcceptInvite, useInvitePreview, useJoinInvite } from "@/lib/api/hooks"
import { applyApiErrors, navigateAfterAuth } from "@/lib/forms"
import { AuthFormSkeleton, AuthHeading } from "./auth-shell"
import { FormAlert } from "./form-alert"
import { PasswordInput } from "./password-input"

type Values = z.infer<typeof acceptInviteSchema>
type JoinValues = z.infer<typeof joinInviteSchema>

export function InviteForm({ token }: { token: string }) {
  const preview = useInvitePreview(token)

  if (preview.isLoading) return <AuthFormSkeleton />
  if (preview.error || !preview.data) {
    const gone = preview.error instanceof ApiRequestError && preview.error.status === 410
    return (
      <>
        <AuthHeading
          title={gone ? "This invite has expired" : "This invite link isn't valid"}
          description={
            gone
              ? "Invites last seven days and work once. Ask the person who invited you to send a new one."
              : "Check that you opened the full link from your email, or ask for a new invite."
          }
        />
        <Button asChild variant="outline" className="w-full">
          <Link href="/login">Go to sign in</Link>
        </Button>
      </>
    )
  }

  const invite = preview.data
  const role = ROLES.find((r) => r.value === invite.role)
  return (
    <>
      <span className="mb-5 grid size-11 place-items-center rounded-xl bg-primary/10 text-primary">
        <UserPlus className="size-5" aria-hidden />
      </span>
      <AuthHeading
        title={`Join ${invite.companyName}`}
        description={
          <>
            <span className="font-medium text-foreground">{invite.invitedBy}</span> invited you to {invite.platformName}.
          </>
        }
      />
      <div className="mb-6 flex items-start justify-between gap-3 rounded-xl border bg-muted/30 p-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{invite.email}</p>
          <p className="text-xs text-muted-foreground">{role?.description}</p>
        </div>
        <Badge variant="secondary" className="shrink-0">
          {role?.label ?? invite.role}
        </Badge>
      </div>
      {invite.existingAccount ? <JoinWithAccount token={token} /> : <CreateAccount token={token} />}
    </>
  )
}

/** New to this install: create the account while accepting. */
function CreateAccount({ token }: { token: string }) {
  const accept = useAcceptInvite(token)
  const [formError, setFormError] = React.useState<string | null>(null)
  const form = useForm<Values>({
    resolver: zodResolver(acceptInviteSchema) as Resolver<Values>,
    defaultValues: { name: "", password: "" },
  })
  const submit = form.handleSubmit(async (values) => {
    setFormError(null)
    try {
      await accept.mutateAsync(values)
      navigateAfterAuth("/")
    } catch (e) {
      setFormError(applyApiErrors(form, e))
    }
  })
  const errors = form.formState.errors
  return (
    <form onSubmit={submit} noValidate className="space-y-5">
      <FormAlert>{formError}</FormAlert>
      <FieldGroup className="gap-4">
        <Field data-invalid={!!errors.name}>
          <FieldLabel htmlFor="name">Your name</FieldLabel>
          <Input id="name" autoComplete="name" autoFocus {...form.register("name")} />
          <FieldError errors={[errors.name]} />
        </Field>
        <Field data-invalid={!!errors.password}>
          <FieldLabel htmlFor="password">Password</FieldLabel>
          <PasswordInput id="password" autoComplete="new-password" invalid={!!errors.password} {...form.register("password")} />
          {errors.password ? <FieldError errors={[errors.password]} /> : <FieldDescription>At least {PASSWORD_MIN} characters.</FieldDescription>}
        </Field>
      </FieldGroup>
      <Button type="submit" className="w-full" disabled={accept.isPending}>
        {accept.isPending && <Loader2 className="animate-spin" />}
        Accept invite
      </Button>
    </form>
  )
}

/** Already has an account here (in another workspace, or removed and invited back): join with it. */
function JoinWithAccount({ token }: { token: string }) {
  const join = useJoinInvite(token)
  const [formError, setFormError] = React.useState<string | null>(null)
  const form = useForm<JoinValues>({
    resolver: zodResolver(joinInviteSchema) as Resolver<JoinValues>,
    defaultValues: { password: "" },
  })
  const submit = form.handleSubmit(async (values) => {
    setFormError(null)
    try {
      const result = await join.mutateAsync(values)
      // With two-step sign-in on, the sign-in page asks for the code next.
      navigateAfterAuth("user" in result ? "/" : "/login")
    } catch (e) {
      setFormError(applyApiErrors(form, e))
    }
  })
  const errors = form.formState.errors
  return (
    <form onSubmit={submit} noValidate className="space-y-5">
      <FormAlert>{formError}</FormAlert>
      <p className="text-sm text-muted-foreground">This email already has an account. Enter its password to join; you can switch between workspaces from the sidebar.</p>
      <FieldGroup className="gap-4">
        <Field data-invalid={!!errors.password}>
          <FieldLabel htmlFor="password">Password</FieldLabel>
          <PasswordInput id="password" autoComplete="current-password" autoFocus invalid={!!errors.password} {...form.register("password")} />
          <FieldError errors={[errors.password]} />
        </Field>
      </FieldGroup>
      <Button type="submit" className="w-full" disabled={join.isPending} data-testid="join-invite">
        {join.isPending && <Loader2 className="animate-spin" />}
        Join workspace
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        Forgot it?{" "}
        <Link href="/forgot-password" className="underline underline-offset-2">
          Reset your password
        </Link>
      </p>
    </form>
  )
}
