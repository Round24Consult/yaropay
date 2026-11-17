"use client"

import { hasPermission } from "@yaropay/core/auth"
import { requireGateway } from "@yaropay/core/gateways/registry"
import { ONBOARDING_STEPS, type OnboardingStatus, type OnboardingStepId } from "@yaropay/core/onboarding"
import { gatewayWebhookUrl } from "@yaropay/core/urls"
import { ArrowRight, Check, ChevronDown, Compass, Send, X } from "lucide-react"
import Link from "next/link"
import * as React from "react"
import { toast } from "sonner"
import { CopyField } from "@/components/shared/copy-field"
import { Panel } from "@/components/shared/page-header"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { useConnections, useSendTestWebhook, useSetOnboardingDismissed, useSettings } from "@/lib/api/hooks"
import { useHasAllProducts, useMe } from "@/lib/auth"
import { site } from "@/lib/site"
import { cn } from "@/lib/utils"

/** Members who can move at least one setup step forward, across every product. */
export function useCanSetUp() {
  const me = useMe()
  const allProducts = useHasAllProducts()
  return allProducts && ONBOARDING_STEPS.some((s) => !s.optional && hasPermission(me, s.permission))
}

function firstOpenStep(status: OnboardingStatus): OnboardingStepId {
  const byId = new Map(status.steps.map((s) => [s.id, s.done]))
  return (ONBOARDING_STEPS.find((s) => !s.optional && !byId.get(s.id)) ?? ONBOARDING_STEPS.find((s) => !byId.get(s.id)) ?? ONBOARDING_STEPS[0]).id
}

/**
 * The setup guide. Each step ticks itself off when the API sees it happen (a
 * signed gateway event, a successful payment, a delivered webhook), so the
 * list always matches the install. `full` is the empty-install welcome; the
 * compact form sits above the dashboard until setup is finished or hidden.
 */
export function SetupChecklist({ status, variant = "compact" }: { status: OnboardingStatus; variant?: "full" | "compact" }) {
  const me = useMe()
  const next = firstOpenStep(status)
  const [selected, setSelected] = React.useState<OnboardingStepId>(next)
  const [collapsed, setCollapsed] = React.useState(false)
  const dismiss = useSetOnboardingDismissed()
  const done = new Map(status.steps.map((s) => [s.id, s.done]))
  const nextDef = ONBOARDING_STEPS.find((s) => s.id === next)!
  const allDone = status.completed === status.total

  // Follow the guide forward when a step completes in the background.
  const lastNext = React.useRef(next)
  React.useEffect(() => {
    if (lastNext.current !== next && selected === lastNext.current) setSelected(next)
    lastNext.current = next
  }, [next, selected])

  const current = ONBOARDING_STEPS.find((s) => s.id === selected)!

  return (
    <Panel className="overflow-hidden" data-testid="setup-checklist" aria-labelledby="setup-title">
      <div className="flex flex-wrap items-center gap-4 border-b bg-muted/30 px-5 py-4">
        <ProgressRing value={status.completed} total={status.total} />
        <div className="min-w-0 flex-1">
          <h2 id="setup-title" className="font-semibold tracking-tight">
            {allDone ? "Your install is ready" : variant === "full" ? `Set up ${site.name} in ${status.total} steps` : `Finish setting up ${site.name}`}
          </h2>
          <p className="text-sm text-muted-foreground" data-testid="setup-progress">
            {status.completed} of {status.total} done
            {!allDone && (
              <>
                {" "}
                · Next: <span className="text-foreground">{nextDef.title}</span>
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" asChild className="text-muted-foreground">
            <Link href="/welcome">
              <Compass /> <span className="max-sm:sr-only">Tour</span>
            </Link>
          </Button>
          {variant === "compact" && (
            <>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setCollapsed((c) => !c)}
                aria-expanded={!collapsed}
                aria-label={collapsed ? "Show steps" : "Collapse steps"}
              >
                <ChevronDown className={cn("transition-transform", collapsed && "-rotate-90")} />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Hide setup guide"
                title="Hide setup guide (bring it back from Getting started in your account menu)"
                data-testid="hide-setup"
                onClick={() =>
                  dismiss.mutate(true, {
                    onSuccess: () => toast("Setup guide hidden", { description: "Bring it back from Getting started in your account menu." }),
                  })
                }
              >
                <X />
              </Button>
            </>
          )}
        </div>
      </div>

      {!collapsed && (
        <div className="grid lg:grid-cols-[minmax(0,19rem)_minmax(0,1fr)]">
          <ol className="flex flex-col gap-0.5 border-b p-2 lg:border-r lg:border-b-0" aria-label="Setup steps">
            {ONBOARDING_STEPS.map((s, i) => {
              const isDone = done.get(s.id) ?? false
              const isSelected = s.id === selected
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(s.id)}
                    aria-current={isSelected ? "step" : undefined}
                    data-testid={`setup-step-${s.id}`}
                    data-done={isDone}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                      isSelected ? "bg-accent text-accent-foreground" : "hover:bg-muted/60",
                    )}
                  >
                    <StepDot index={i + 1} done={isDone} active={s.id === next && !isDone} />
                    <span className={cn("min-w-0 flex-1 truncate", isDone && "text-muted-foreground")}>{s.title}</span>
                    {s.optional && <span className="text-[11px] text-muted-foreground">Optional</span>}
                  </button>
                </li>
              )
            })}
          </ol>
          <div className="min-w-0 p-5 sm:p-6" aria-live="polite">
            <StepDetail step={current} done={done.get(current.id) ?? false} status={status} canDo={hasPermission(me, current.permission)} />
          </div>
        </div>
      )}
    </Panel>
  )
}

function StepDetail({
  step,
  done,
  status,
  canDo,
}: {
  step: (typeof ONBOARDING_STEPS)[number]
  done: boolean
  status: OnboardingStatus
  canDo: boolean
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-base font-semibold tracking-tight">{step.title}</h3>
          {done && (
            <span className="inline-flex items-center gap-1 rounded-full bg-good/12 px-2 py-0.5 text-xs font-medium text-good-text">
              <Check className="size-3" /> Done
            </span>
          )}
        </div>
        <p className="max-w-prose text-sm text-muted-foreground text-pretty">{step.description}</p>
      </div>
      {canDo ? (
        <StepAction id={step.id} done={done} status={status} />
      ) : (
        <p className="rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">Your role can&apos;t do this step. Ask an owner or admin.</p>
      )}
    </div>
  )
}

function StepAction({ id, done, status }: { id: OnboardingStepId; done: boolean; status: OnboardingStatus }) {
  const { data: settings } = useSettings()
  const { data: connections = [] } = useConnections()
  switch (id) {
    case "base_url":
      return (
        <div className="space-y-3">
          {settings && (
            <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">Now:</span>
              <code className="min-w-0 truncate rounded-md bg-muted px-2 py-0.5 font-mono text-[12.5px]">{settings.baseUrl}</code>
              {!done && <span className="text-xs text-warning-text">Gateways can&apos;t reach this address</span>}
            </div>
          )}
          <ActionLink href="/settings?tab=general" primary={!done}>
            {done ? "Change public URL" : "Set public URL"}
          </ActionLink>
        </div>
      )
    case "gateway":
      return (
        <ActionLink href="/apps" primary={!done}>
          {done ? "Manage gateways" : "Connect Paystack or Flutterwave"}
        </ActionLink>
      )
    case "gateway_webhook": {
      const connection = connections.find((c) => c.id === status.connectionId)
      if (!connection || !settings) return <Waiting text="Connect a gateway first. Its webhook URL will show up here." />
      const gateway = requireGateway(connection.gatewayId)
      return (
        <div className="space-y-4">
          <CopyField
            label={`Webhook URL for ${gateway.name} · ${connection.label}`}
            value={gatewayWebhookUrl(settings.baseUrl, connection.gatewayId, connection.id)}
            hint={gateway.dashboardSetupSteps[0]}
            testId="setup-webhook-url"
          />
          <div className="flex flex-wrap items-center gap-3">
            <ActionLink href={`/apps/${connection.id}`} primary={false}>
              Full setup steps
            </ActionLink>
            {!done && <Waiting text={`Waiting for the first signed event from ${gateway.name}`} pulse />}
          </div>
        </div>
      )
    }
    case "product":
      return (
        <ActionLink href={status.productId ? "/products" : "/products/new"} primary={!done}>
          {done ? "View products" : "Add a product"}
        </ActionLink>
      )
    case "test_payment":
      if (!status.productId) return <Waiting text="Add a product first. Its test API key and code samples are on its Integration tab." />
      return (
        <div className="flex flex-wrap items-center gap-3">
          <ActionLink href={`/products/${status.productId}?tab=integration`} primary={!done}>
            Open the integration guide
          </ActionLink>
          {!done && <Waiting text="Waiting for a successful payment" pulse />}
        </div>
      )
    case "product_webhook":
      if (!status.productId) return <Waiting text="Add a product first, with the URL of the endpoint that should receive events." />
      return <TestEventAction productId={status.productId} done={done} />
    case "team":
      return (
        <ActionLink href="/settings?tab=team" primary={!done}>
          {done ? "Manage team" : "Invite teammates"}
        </ActionLink>
      )
  }
}

function TestEventAction({ productId, done }: { productId: string; done: boolean }) {
  const send = useSendTestWebhook(productId)
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        variant={done ? "outline" : "default"}
        disabled={send.isPending}
        data-testid="setup-send-test"
        onClick={async () => {
          // mutateAsync: a delivered event completes the step and the guide moves on, unmounting this button.
          try {
            const d = await send.mutateAsync()
            if (d.state === "delivered") toast.success("Test event delivered", { description: `Your endpoint answered ${d.statusCode} in ${d.latencyMs} ms.` })
            else
              toast.error("Your endpoint didn't accept the test event", {
                description: d.statusCode ? `It answered ${d.statusCode}. Return any 2xx status.` : "It couldn't be reached. Check the URL in the product's settings.",
              })
          } catch (e) {
            toast.error((e as Error).message)
          }
        }}
      >
        {send.isPending ? <Spinner /> : <Send />} Send a test event
      </Button>
      <ActionLink href={`/products/${productId}?tab=webhooks`} primary={false}>
        Deliveries
      </ActionLink>
    </div>
  )
}

function ActionLink({ href, primary, children }: { href: string; primary: boolean; children: React.ReactNode }) {
  return (
    <Button asChild size="sm" variant={primary ? "default" : "outline"}>
      <Link href={href}>
        {children} <ArrowRight />
      </Link>
    </Button>
  )
}

function Waiting({ text, pulse }: { text: string; pulse?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
      {pulse && (
        <span className="relative flex size-2" aria-hidden>
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary/60 motion-reduce:animate-none" />
          <span className="relative inline-flex size-2 rounded-full bg-primary" />
        </span>
      )}
      {text}
    </span>
  )
}

function StepDot({ index, done, active }: { index: number; done: boolean; active: boolean }) {
  return (
    <span
      className={cn(
        "grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold tabular-nums transition-colors",
        done ? "bg-good text-white dark:text-black" : active ? "bg-primary text-primary-foreground" : "border bg-background text-muted-foreground",
      )}
      aria-hidden
    >
      {done ? <Check className="size-3.5" strokeWidth={3} /> : index}
    </span>
  )
}

function ProgressRing({ value, total }: { value: number; total: number }) {
  const r = 16
  const c = 2 * Math.PI * r
  const pct = total ? value / total : 0
  return (
    <div className="relative grid size-11 shrink-0 place-items-center" role="img" aria-label={`${value} of ${total} setup steps done`}>
      <svg viewBox="0 0 40 40" className="absolute inset-0 -rotate-90">
        <circle cx="20" cy="20" r={r} fill="none" stroke="var(--muted)" strokeWidth="4" />
        <circle
          cx="20"
          cy="20"
          r={r}
          fill="none"
          stroke={pct === 1 ? "var(--good)" : "var(--primary)"}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          className="transition-[stroke-dashoffset] duration-700 ease-out motion-reduce:transition-none"
        />
      </svg>
      <span className="text-[11px] font-semibold tabular-nums">
        {value}/{total}
      </span>
    </div>
  )
}
