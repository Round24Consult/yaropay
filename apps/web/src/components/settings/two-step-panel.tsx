"use client"

import { Download, Loader2, ShieldCheck } from "lucide-react"
import QRCode from "qrcode"
import * as React from "react"
import { toast } from "sonner"
import { PasswordInput } from "@/components/auth/password-input"
import { CopyButton, useCopy } from "@/components/shared/copy-field"
import { Panel, PanelHeader } from "@/components/shared/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { ApiRequestError } from "@/lib/api/client"
import { useMfaDisable, useMfaEnable, useMfaSetup, useMfaStatus, useRecoveryCodes } from "@/lib/api/hooks"
import { useMe } from "@/lib/auth"
import { formatRelative } from "@/lib/format"

/** Two-step sign-in with an authenticator app: set up, new recovery codes, turn off. */
export function TwoStepPanel() {
  const { data, isLoading } = useMfaStatus()
  const [dialog, setDialog] = React.useState<"setup" | "codes" | "disable" | null>(null)
  const close = () => setDialog(null)

  return (
    <Panel className="self-start" data-testid="two-step-panel">
      <PanelHeader
        title="Two-step sign-in"
        description="Ask for a code from an authenticator app (Google Authenticator, 1Password, Authy and others) as well as your password."
        actions={data?.enabled ? <Badge variant="secondary" className="gap-1"><ShieldCheck className="size-3 text-good-text" aria-hidden />On</Badge> : undefined}
      />
      <div className="p-5 pt-3">
        {isLoading || !data ? (
          <Skeleton className="h-9" />
        ) : data.enabled ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Turned on {data.enabledAt ? formatRelative(data.enabledAt) : ""}.{" "}
              <span className={data.recoveryCodesLeft <= 3 ? "font-medium text-foreground" : undefined} data-testid="recovery-codes-left">
                {data.recoveryCodesLeft} recovery code{data.recoveryCodesLeft === 1 ? "" : "s"} left.
              </span>
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => setDialog("codes")}>
                New recovery codes
              </Button>
              <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setDialog("disable")}>
                Turn off
              </Button>
            </div>
          </div>
        ) : (
          <Button size="sm" onClick={() => setDialog("setup")} data-testid="mfa-setup-start">
            Set up two-step sign-in
          </Button>
        )}
      </div>
      <Dialog open={dialog !== null} onOpenChange={(open) => !open && close()}>
        <DialogContent className="sm:max-w-md">
          {dialog === "setup" && <SetupFlow onDone={close} />}
          {dialog === "codes" && <NewCodesFlow onDone={close} />}
          {dialog === "disable" && <DisableFlow onDone={close} />}
        </DialogContent>
      </Dialog>
    </Panel>
  )
}

function fieldError(e: unknown, field: string): string {
  if (e instanceof ApiRequestError) return e.fields?.[field] ?? e.message
  return "Something went wrong. Try again."
}

function PasswordStep({ title, description, action, pending, onSubmit, onCancel }: {
  title: string
  description: string
  action: string
  pending: boolean
  onSubmit: (password: string) => Promise<string | null>
  onCancel: () => void
}) {
  const [password, setPassword] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault()
        setError(await onSubmit(password))
      }}
      noValidate
      className="space-y-4"
    >
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <Field data-invalid={!!error}>
        <FieldLabel htmlFor="confirm-password">Your password</FieldLabel>
        <PasswordInput id="confirm-password" autoComplete="current-password" autoFocus invalid={!!error} value={password} onChange={(e) => setPassword(e.target.value)} data-testid="mfa-password" />
        {error && <FieldError errors={[{ message: error }]} />}
      </Field>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending || !password} data-testid="mfa-password-submit">
          {pending && <Loader2 className="animate-spin" />}
          {action}
        </Button>
      </DialogFooter>
    </form>
  )
}

function SetupFlow({ onDone }: { onDone: () => void }) {
  const setup = useMfaSetup()
  const enable = useMfaEnable()
  const me = useMe()
  const [secret, setSecret] = React.useState<{ secret: string; otpauthUri: string } | null>(null)
  const [qr, setQr] = React.useState<string | null>(null)
  const [code, setCode] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [codes, setCodes] = React.useState<string[] | null>(null)

  React.useEffect(() => {
    if (!secret) return
    QRCode.toString(secret.otpauthUri, { type: "svg", margin: 1, errorCorrectionLevel: "M" }).then(setQr, () => setQr(null))
  }, [secret])

  if (codes) return <RecoveryCodes codes={codes} email={me.email} onDone={onDone} intro="Two-step sign-in is on. Your other sessions were signed out." />

  if (!secret) {
    return (
      <PasswordStep
        title="Set up two-step sign-in"
        description="Enter your password to start."
        action="Continue"
        pending={setup.isPending}
        onCancel={onDone}
        onSubmit={async (password) => {
          try {
            setSecret(await setup.mutateAsync({ password }))
            return null
          } catch (e) {
            return fieldError(e, "password")
          }
        }}
      />
    )
  }

  const grouped = secret.secret.match(/.{1,4}/g)?.join(" ") ?? secret.secret
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault()
        setError(null)
        try {
          const res = await enable.mutateAsync({ code })
          setCodes(res.recoveryCodes)
        } catch (err) {
          setError(fieldError(err, "code"))
          setCode("")
        }
      }}
      noValidate
      className="space-y-4"
    >
      <DialogHeader>
        <DialogTitle>Scan this with your authenticator app</DialogTitle>
        <DialogDescription>Then enter the 6-digit code it shows, to check everything works.</DialogDescription>
      </DialogHeader>
      <div className="flex flex-col items-center gap-3">
        <div
          className="size-44 rounded-lg border bg-white p-2 [&>svg]:size-full"
          role="img"
          aria-label="QR code for your authenticator app"
          // The SVG comes from the qrcode library, built from our own otpauth link.
          dangerouslySetInnerHTML={qr ? { __html: qr } : undefined}
        />
        <div className="w-full space-y-1">
          <p className="text-xs text-muted-foreground">Can&apos;t scan it? Type this key into the app instead:</p>
          <div className="flex items-center gap-1 rounded-lg border bg-muted/40 py-1 pr-1 pl-3">
            <code className="min-w-0 flex-1 font-mono text-[12.5px] break-all" data-testid="mfa-secret">
              {grouped}
            </code>
            <CopyButton value={secret.secret} label="Key" />
          </div>
        </div>
      </div>
      <Field data-invalid={!!error}>
        <FieldLabel htmlFor="mfa-enable-code">Code from the app</FieldLabel>
        <Input
          id="mfa-enable-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          placeholder="123456"
          className="font-mono tracking-[0.3em]"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          data-testid="mfa-enable-code"
        />
        {error && <FieldError errors={[{ message: error }]} />}
      </Field>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={enable.isPending || code.length !== 6} data-testid="mfa-enable-submit">
          {enable.isPending && <Loader2 className="animate-spin" />}
          Turn on
        </Button>
      </DialogFooter>
    </form>
  )
}

function RecoveryCodes({ codes, email, intro, onDone }: { codes: string[]; email: string; intro: string; onDone: () => void }) {
  const { copy } = useCopy()
  const text = `Recovery codes for ${email}\nEach code works once. Keep them somewhere safe.\n\n${codes.join("\n")}\n`
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }))
    const a = document.createElement("a")
    a.href = url
    a.download = "yaropay-recovery-codes.txt"
    a.click()
    URL.revokeObjectURL(url)
  }
  return (
    <div className="space-y-4">
      <DialogHeader>
        <DialogTitle>Save your recovery codes</DialogTitle>
        <DialogDescription>
          {intro} If you lose your phone, each of these codes gets you in once. This is the only time they are shown.
        </DialogDescription>
      </DialogHeader>
      <ol className="grid grid-cols-2 gap-x-6 gap-y-1.5 rounded-lg border bg-muted/40 p-4 font-mono text-sm" data-testid="recovery-codes">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ol>
      <div className="flex gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => copy(codes.join("\n"), "Recovery codes")}>
          Copy
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={download}>
          <Download />
          Download
        </Button>
      </div>
      <DialogFooter>
        <Button type="button" onClick={onDone} data-testid="recovery-codes-done">
          I&apos;ve saved them
        </Button>
      </DialogFooter>
    </div>
  )
}

function NewCodesFlow({ onDone }: { onDone: () => void }) {
  const regenerate = useRecoveryCodes()
  const me = useMe()
  const [codes, setCodes] = React.useState<string[] | null>(null)
  if (codes) return <RecoveryCodes codes={codes} email={me.email} onDone={onDone} intro="Your old recovery codes no longer work." />
  return (
    <PasswordStep
      title="Make new recovery codes"
      description="The codes you have now stop working. Enter your password to continue."
      action="Make new codes"
      pending={regenerate.isPending}
      onCancel={onDone}
      onSubmit={async (password) => {
        try {
          setCodes((await regenerate.mutateAsync({ password })).recoveryCodes)
          return null
        } catch (e) {
          return fieldError(e, "password")
        }
      }}
    />
  )
}

function DisableFlow({ onDone }: { onDone: () => void }) {
  const disable = useMfaDisable()
  const [password, setPassword] = React.useState("")
  const [code, setCode] = React.useState("")
  const [errors, setErrors] = React.useState<{ password?: string; code?: string; form?: string }>({})
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault()
        setErrors({})
        try {
          await disable.mutateAsync({ password, code })
          toast.success("Two-step sign-in is off")
          onDone()
        } catch (err) {
          if (err instanceof ApiRequestError && err.fields) setErrors({ password: err.fields.password, code: err.fields.code })
          else setErrors({ form: err instanceof Error ? err.message : "Could not turn it off" })
        }
      }}
      noValidate
      className="space-y-4"
    >
      <DialogHeader>
        <DialogTitle>Turn off two-step sign-in?</DialogTitle>
        <DialogDescription>Signing in will need only your password. Enter your password and a code from your app (or a recovery code).</DialogDescription>
      </DialogHeader>
      <Field data-invalid={!!errors.password}>
        <FieldLabel htmlFor="disable-password">Your password</FieldLabel>
        <PasswordInput id="disable-password" autoComplete="current-password" autoFocus invalid={!!errors.password} value={password} onChange={(e) => setPassword(e.target.value)} />
        {errors.password && <FieldError errors={[{ message: errors.password }]} />}
      </Field>
      <Field data-invalid={!!errors.code}>
        <FieldLabel htmlFor="disable-code">Code</FieldLabel>
        <Input id="disable-code" autoComplete="one-time-code" className="font-mono" value={code} onChange={(e) => setCode(e.target.value)} />
        {errors.code ? <FieldError errors={[{ message: errors.code }]} /> : <FieldDescription>6 digits from the app, or a recovery code.</FieldDescription>}
      </Field>
      {errors.form && <p className="text-sm text-destructive">{errors.form}</p>}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="destructive" disabled={disable.isPending || !password || code.trim().length < 6}>
          {disable.isPending && <Loader2 className="animate-spin" />}
          Turn off
        </Button>
      </DialogFooter>
    </form>
  )
}
