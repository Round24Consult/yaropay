"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { changePasswordSchema, PASSWORD_MIN, profileSchema, TRUSTED_BROWSER_DAYS } from "@yaropay/core/auth"
import { Laptop, Loader2, ShieldCheck, Smartphone } from "lucide-react"
import * as React from "react"
import { type Resolver, useForm } from "react-hook-form"
import { toast } from "sonner"
import type { z } from "zod"
import { PasswordInput } from "@/components/auth/password-input"
import { roleLabel } from "@/components/layout/user-menu"
import { Panel, PanelHeader } from "@/components/shared/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import {
  useChangePassword,
  useMfaStatus,
  useRemoveAllTrustedBrowsers,
  useRemoveTrustedBrowser,
  useRevokeSession,
  useSessions,
  useTrustedBrowsers,
  useUpdateProfile,
} from "@/lib/api/hooks"
import { useMe } from "@/lib/auth"
import { applyApiErrors } from "@/lib/forms"
import { formatDate, formatRelative } from "@/lib/format"
import { TwoStepPanel } from "./two-step-panel"

export function SecurityPanel() {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="min-w-0 space-y-6">
        <ProfileForm />
        <PasswordForm />
      </div>
      <div className="min-w-0 space-y-6">
        <TwoStepPanel />
        <TrustedBrowsers />
        <Sessions />
      </div>
    </div>
  )
}

type ProfileValues = z.infer<typeof profileSchema>

function ProfileForm() {
  const me = useMe()
  const update = useUpdateProfile()
  const form = useForm<ProfileValues>({ resolver: zodResolver(profileSchema) as Resolver<ProfileValues>, defaultValues: { name: me.name } })
  const errors = form.formState.errors
  const submit = form.handleSubmit(async (values) => {
    try {
      const { user } = await update.mutateAsync(values)
      form.reset({ name: user.name })
      toast.success("Profile saved")
    } catch (e) {
      const message = applyApiErrors(form, e)
      if (message) toast.error(message)
    }
  })
  return (
    <Panel>
      <PanelHeader title="Profile" />
      <form onSubmit={submit} noValidate className="p-5">
        <FieldGroup className="gap-4">
          <Field data-invalid={!!errors.name}>
            <FieldLabel htmlFor="profile-name">Name</FieldLabel>
            <Input id="profile-name" autoComplete="name" {...form.register("name")} />
            <FieldError errors={[errors.name]} />
          </Field>
          <Field>
            <FieldLabel htmlFor="profile-email">Email</FieldLabel>
            <Input id="profile-email" value={me.email} readOnly disabled />
            <FieldDescription>
              Signed in as {roleLabel(me.role).toLowerCase()}
              {me.productIds !== null ? `, limited to ${me.productIds.length} product${me.productIds.length === 1 ? "" : "s"}` : ""}.
            </FieldDescription>
          </Field>
        </FieldGroup>
        <Button type="submit" size="sm" className="mt-5" disabled={!form.formState.isDirty || update.isPending}>
          {update.isPending && <Loader2 className="animate-spin" />}
          Save profile
        </Button>
      </form>
    </Panel>
  )
}

type PasswordValues = z.infer<typeof changePasswordSchema>

function PasswordForm() {
  const change = useChangePassword()
  const form = useForm<PasswordValues>({
    resolver: zodResolver(changePasswordSchema) as Resolver<PasswordValues>,
    defaultValues: { currentPassword: "", newPassword: "" },
  })
  const errors = form.formState.errors
  const submit = form.handleSubmit(async (values) => {
    try {
      await change.mutateAsync(values)
      form.reset()
      toast.success("Password changed. Your other sessions were signed out.")
    } catch (e) {
      const message = applyApiErrors(form, e)
      if (message) form.setError("currentPassword", { message })
    }
  })
  return (
    <Panel>
      <PanelHeader title="Password" description="Changing it signs you out of every other browser." />
      <form onSubmit={submit} noValidate className="p-5">
        <FieldGroup className="gap-4">
          <Field data-invalid={!!errors.currentPassword}>
            <FieldLabel htmlFor="current-password">Current password</FieldLabel>
            <PasswordInput id="current-password" autoComplete="current-password" invalid={!!errors.currentPassword} {...form.register("currentPassword")} />
            <FieldError errors={[errors.currentPassword]} />
          </Field>
          <Field data-invalid={!!errors.newPassword}>
            <FieldLabel htmlFor="new-password">New password</FieldLabel>
            <PasswordInput id="new-password" autoComplete="new-password" invalid={!!errors.newPassword} {...form.register("newPassword")} />
            {errors.newPassword ? <FieldError errors={[errors.newPassword]} /> : <FieldDescription>At least {PASSWORD_MIN} characters.</FieldDescription>}
          </Field>
        </FieldGroup>
        <Button type="submit" size="sm" className="mt-5" disabled={change.isPending}>
          {change.isPending && <Loader2 className="animate-spin" />}
          Change password
        </Button>
      </form>
    </Panel>
  )
}

/** "Chrome on macOS" from a user agent string; good enough for a session list. */
function describeAgent(ua: string | null) {
  if (!ua) return { label: "Unknown device", mobile: false }
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Firefox\//.test(ua)
      ? "Firefox"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Safari\//.test(ua)
          ? "Safari"
          : /curl|node|undici/i.test(ua)
            ? "API client"
            : "Browser"
  const os = /iPhone|iPad/.test(ua)
    ? "iOS"
    : /Android/.test(ua)
      ? "Android"
      : /Mac OS X|Macintosh/.test(ua)
        ? "macOS"
        : /Windows/.test(ua)
          ? "Windows"
          : /Linux/.test(ua)
            ? "Linux"
            : null
  return { label: os ? `${browser} on ${os}` : browser, mobile: /Mobile|iPhone|Android/.test(ua) }
}

function Sessions() {
  const { data, isLoading } = useSessions()
  const revoke = useRevokeSession()
  return (
    <Panel className="overflow-hidden">
      <PanelHeader title="Active sessions" description="Browsers signed in to your account. Sessions end after 30 days without use." />
      <ul className="mt-3 divide-y border-t">
        {isLoading &&
          [0, 1].map((i) => (
            <li key={i} className="px-5 py-3">
              <Skeleton className="h-9" />
            </li>
          ))}
        {data?.map((s) => {
          const agent = describeAgent(s.userAgent)
          const Icon = agent.mobile ? Smartphone : Laptop
          return (
            <li key={s.id} className="flex items-center gap-3 px-5 py-3">
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                <Icon className="size-4" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-sm font-medium">
                  {agent.label}
                  {s.current && (
                    <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
                      This device
                    </Badge>
                  )}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {s.ip ?? "Unknown IP"} · active {formatRelative(s.lastSeenAt)} · signed in {formatRelative(s.createdAt)}
                </p>
              </div>
              {!s.current && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={revoke.isPending && revoke.variables === s.id}
                  onClick={() =>
                    revoke.mutate(s.id, {
                      onSuccess: () => toast.success("Session signed out"),
                      onError: (e) => toast.error(e.message),
                    })
                  }
                >
                  Sign out
                </Button>
              )}
            </li>
          )
        })}
      </ul>
    </Panel>
  )
}

/** Browsers that skip the authenticator code at sign-in. Only shown while two-step sign-in is on. */
function TrustedBrowsers() {
  const { data: mfa } = useMfaStatus()
  const enabled = mfa?.enabled === true
  const { data, isLoading } = useTrustedBrowsers(enabled)
  const remove = useRemoveTrustedBrowser()
  const removeAll = useRemoveAllTrustedBrowsers()
  if (!enabled) return null
  return (
    <Panel className="overflow-hidden" data-testid="trusted-browsers">
      <PanelHeader
        title="Trusted browsers"
        description={`Browsers where you ticked "Trust this browser" skip the authenticator code for ${TRUSTED_BROWSER_DAYS} days. They still need your password, and changing it removes them all.`}
        actions={
          data && data.length > 1 ? (
            <Button
              variant="outline"
              size="sm"
              disabled={removeAll.isPending}
              onClick={() =>
                removeAll.mutate(undefined, {
                  onSuccess: () => toast.success("Trusted browsers removed"),
                  onError: (e) => toast.error(e.message),
                })
              }
            >
              Remove all
            </Button>
          ) : undefined
        }
      />
      <ul className="mt-3 divide-y border-t">
        {isLoading && (
          <li className="px-5 py-3">
            <Skeleton className="h-9" />
          </li>
        )}
        {data?.length === 0 && (
          <li className="px-5 py-4 text-sm text-muted-foreground">
            No trusted browsers. Tick &ldquo;Trust this browser&rdquo; when you enter your code to skip it on that browser.
          </li>
        )}
        {data?.map((b) => (
          <li key={b.id} className="flex items-center gap-3 px-5 py-3" data-testid="trusted-browser">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
              <ShieldCheck className="size-4" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-sm font-medium">
                {b.label}
                {b.current && (
                  <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
                    This browser
                  </Badge>
                )}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                Trusted {formatRelative(b.createdAt)}
                {b.lastUsedAt ? ` · last used ${formatRelative(b.lastUsedAt)}` : ""} · until {formatDate(b.expiresAt)}
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              disabled={remove.isPending && remove.variables === b.id}
              onClick={() =>
                remove.mutate(b.id, {
                  onSuccess: () => toast.success(b.current ? "This browser will ask for your code next time" : "Trusted browser removed"),
                  onError: (e) => toast.error(e.message),
                })
              }
            >
              Remove
            </Button>
          </li>
        ))}
      </ul>
    </Panel>
  )
}
