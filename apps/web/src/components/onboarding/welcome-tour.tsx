"use client"

import { ArrowLeft, ArrowRight, FlaskConical, Rocket, Send, Tag, Webhook } from "lucide-react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import * as React from "react"
import { BrandMark } from "@/components/shared/brand-mark"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { useOnboarding, useSetOnboardingDismissed } from "@/lib/api/hooks"
import { useCan, useMe } from "@/lib/auth"
import { site } from "@/lib/site"
import { cn } from "@/lib/utils"
import { useCanSetUp } from "./setup-checklist"
import { useLoadSample } from "./sample-data"

const SLIDES = ["Why it exists", "How payments flow", "Get started"] as const

/** A three-step walkthrough shown after first-run setup, and from the account menu at any time. */
export function WelcomeTour() {
  const me = useMe()
  const [index, setIndex] = React.useState(0)
  const [direction, setDirection] = React.useState(1)
  const reduce = useReducedMotion()
  const last = index === SLIDES.length - 1

  const go = React.useCallback((to: number) => {
    setIndex((from) => {
      const next = Math.max(0, Math.min(SLIDES.length - 1, to))
      setDirection(next >= from ? 1 : -1)
      return next
    })
  }, [])

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.closest("input, textarea, [role=dialog]")) return
      if (e.key === "ArrowRight") go(index + 1)
      if (e.key === "ArrowLeft") go(index - 1)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [go, index])

  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden bg-background">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,color-mix(in_oklch,var(--primary)_12%,transparent),transparent_55%)]" aria-hidden />
      <header className="relative mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-5 sm:px-6">
        <Link href="/" className="inline-flex items-center gap-2.5 rounded-lg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
          <BrandMark />
          <span className="text-sm font-semibold tracking-tight">{site.name}</span>
        </Link>
        <Button variant="ghost" size="sm" asChild className="text-muted-foreground">
          <Link href="/" data-testid="skip-tour">
            Skip tour
          </Link>
        </Button>
      </header>

      <main id="content" className="relative mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 pb-8 sm:px-6">
        <p className="text-sm text-muted-foreground">Welcome, {me.name.split(" ")[0]}</p>
        <nav aria-label="Tour steps" className="mt-4 grid grid-cols-3 gap-2">
          {SLIDES.map((label, i) => (
            <button
              key={label}
              type="button"
              onClick={() => go(i)}
              aria-current={i === index ? "step" : undefined}
              className="group text-left focus-visible:outline-none"
            >
              <span className="block h-1 overflow-hidden rounded-full bg-muted">
                <span className={cn("block h-full rounded-full bg-primary transition-[width] duration-500 motion-reduce:transition-none", i <= index ? "w-full" : "w-0")} />
              </span>
              <span
                className={cn(
                  "mt-2 block truncate text-xs group-focus-visible:underline",
                  i === index ? "font-medium text-foreground" : "text-muted-foreground",
                )}
              >
                <span className="tabular-nums">{i + 1}.</span> {label}
              </span>
            </button>
          ))}
        </nav>

        <div className="relative mt-8 flex-1">
          <AnimatePresence mode="wait" initial={false} custom={direction}>
            <motion.section
              key={index}
              custom={direction}
              initial={reduce ? { opacity: 0 } : { opacity: 0, x: direction * 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, x: direction * -24 }}
              transition={{ duration: 0.22, ease: "easeOut" }}
              aria-labelledby={`slide-${index}`}
              data-testid={`tour-slide-${index + 1}`}
            >
              {index === 0 && <WhySlide />}
              {index === 1 && <FlowSlide />}
              {index === 2 && <StartSlide />}
            </motion.section>
          </AnimatePresence>
        </div>

        <footer className="mt-8 flex items-center justify-between gap-3 border-t pt-5">
          <Button variant="ghost" onClick={() => go(index - 1)} disabled={index === 0} className={cn(index === 0 && "invisible")}>
            <ArrowLeft /> Back
          </Button>
          <span className="text-xs text-muted-foreground tabular-nums max-sm:hidden">
            {index + 1} / {SLIDES.length} · use ← → to move
          </span>
          {!last && (
            <Button onClick={() => go(index + 1)} data-testid="tour-next">
              Next <ArrowRight />
            </Button>
          )}
          {last && <span className="w-24" aria-hidden />}
        </footer>
      </main>
    </div>
  )
}

function SlideHeading({ id, eyebrow, title, children }: { id: string; eyebrow: string; title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <p className="text-xs font-medium tracking-wide text-primary uppercase">{eyebrow}</p>
      <h1 id={id} className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
        {title}
      </h1>
      <p className="max-w-xl text-base text-muted-foreground text-pretty">{children}</p>
    </div>
  )
}

const LANES = [
  { name: "Shop", slot: 1, y: 20, ref: "SHW_8F2K" },
  { name: "SaaS", slot: 2, y: 50, ref: "LDG_Q7MA" },
  { name: "App", slot: 3, y: 80, ref: "RDN_C41X" },
]

function WhySlide() {
  return (
    <div className="grid items-center gap-10 lg:grid-cols-2">
      <div className="space-y-8">
        <SlideHeading id="slide-0" eyebrow="Why it exists" title="One gateway account. Every product kept apart.">
          You run several websites and apps but one Paystack or Flutterwave account. {site.name} sits between them, so every payment, event and report stays
          with the product that started it.
        </SlideHeading>
        <ul className="space-y-4">
          {[
            { icon: Tag, title: "Each product stamps its own prefix", text: "Payments from your shop start with SHW_, your SaaS with LDG_. The gateway account stays shared." },
            { icon: Webhook, title: "One webhook URL per gateway account", text: "The gateway sends every event to that one URL, and the signature is checked before anything happens." },
            { icon: Send, title: "Each product only hears about its own payments", text: "Verified events are forwarded, signed and retried, to the product the payment belongs to." },
          ].map((p) => (
            <li key={p.title} className="flex gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl border bg-card shadow-card">
                <p.icon className="size-4 text-primary" aria-hidden />
              </span>
              <div>
                <p className="text-sm font-medium">{p.title}</p>
                <p className="text-sm text-muted-foreground">{p.text}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
      <RoutingDiagram />
    </div>
  )
}

function RoutingDiagram() {
  return (
    <figure className="rounded-2xl border bg-card p-5 shadow-card" aria-label="Three products send payments through YaroPay to one gateway account">
      <svg viewBox="0 0 120 100" className="w-full" fill="none" role="img" aria-hidden>
        {LANES.map((l) => (
          <path key={l.name} d={`M 30 ${l.y} C 48 ${l.y}, 46 50, 60 50`} stroke={`var(--series-${l.slot})`} strokeWidth="1.3" strokeLinecap="round" />
        ))}
        <path d="M 84 50 H 96" stroke="var(--primary)" strokeWidth="1.4" strokeLinecap="round" strokeDasharray="2 2.2" />
        {LANES.map((l) => (
          <g key={`n-${l.name}`}>
            <rect x="2" y={l.y - 8} width="28" height="16" rx="3.5" fill="var(--card)" stroke="var(--border)" strokeWidth="0.5" />
            <circle cx="7" cy={l.y - 2.4} r="1.5" fill={`var(--series-${l.slot})`} />
            <text x="10" y={l.y - 1.2} fontSize="3.6" fill="var(--foreground)" fontFamily="var(--font-sans)" fontWeight="600">
              {l.name}
            </text>
            <text x="6" y={l.y + 4.6} fontSize="2.9" fill="var(--muted-foreground)" fontFamily="var(--font-geist-mono)">
              {l.ref}…
            </text>
          </g>
        ))}
        <rect x="60" y="40" width="24" height="20" rx="4" fill="var(--primary)" />
        <text x="72" y="51.3" fontSize="3.8" textAnchor="middle" fill="var(--primary-foreground)" fontFamily="var(--font-sans)" fontWeight="600">
          {site.name}
        </text>
        <rect x="96" y="42" width="22" height="16" rx="3.5" fill="var(--card)" stroke="var(--border)" strokeWidth="0.5" />
        <text x="107" y="49.2" fontSize="3.3" textAnchor="middle" fill="var(--foreground)" fontFamily="var(--font-sans)" fontWeight="600">
          Paystack
        </text>
        <text x="107" y="53.8" fontSize="2.7" textAnchor="middle" fill="var(--muted-foreground)" fontFamily="var(--font-sans)">
          one account
        </text>
      </svg>
      <figcaption className="mt-3 text-center text-xs text-muted-foreground">Three products, one gateway account, no mixed-up sales.</figcaption>
    </figure>
  )
}

const ACTORS = {
  product: { label: "Your product", className: "bg-[color-mix(in_oklch,var(--series-1)_14%,transparent)] text-foreground" },
  yaropay: { label: site.name, className: "bg-primary/12 text-primary" },
  gateway: { label: "Gateway", className: "bg-muted text-foreground" },
  customer: { label: "Customer", className: "bg-[color-mix(in_oklch,var(--series-3)_14%,transparent)] text-foreground" },
} as const

const FLOW: { actor: keyof typeof ACTORS; title: string; text: React.ReactNode }[] = [
  {
    actor: "product",
    title: "Asks for a payment",
    text: (
      <>
        Your server calls <code className="rounded bg-muted px-1 font-mono text-[12px]">POST /v1/products/:id/payments</code> with the product&apos;s API key.
      </>
    ),
  },
  { actor: "yaropay", title: "Starts it on the gateway", text: "With the product's reference prefix and its own callback URL, then returns the checkout link." },
  { actor: "customer", title: "Pays on the checkout page", text: "Card, bank transfer, USSD or mobile money, whatever the gateway offers." },
  { actor: "gateway", title: "Reports back", text: "It sends the customer to the callback and posts a webhook. Both are checked with the gateway's API before anything is trusted." },
  {
    actor: "yaropay",
    title: "Hands the result to the right product",
    text: "The customer lands on your success or failure page, and your server gets a signed payment.succeeded event, retried until it answers 2xx.",
  },
]

function FlowSlide() {
  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <SlideHeading id="slide-1" eyebrow="How a payment travels" title="Your product never talks to the gateway directly.">
        It asks {site.name} for a payment and gets one signed answer back. The gateway keys, signature checks and retries stay in one place.
      </SlideHeading>
      <ol className="relative space-y-1">
        {FLOW.map((s, i) => (
          <li key={s.title} className="relative flex gap-4 pb-5 last:pb-0">
            {i < FLOW.length - 1 && <span className="absolute top-8 bottom-0 left-[15px] w-px bg-border" aria-hidden />}
            <span className="relative grid size-8 shrink-0 place-items-center rounded-full border bg-card text-xs font-semibold tabular-nums shadow-card">{i + 1}</span>
            <div className="min-w-0 pt-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", ACTORS[s.actor].className)}>{ACTORS[s.actor].label}</span>
                <p className="text-sm font-medium">{s.title}</p>
              </div>
              <p className="mt-1 text-sm text-muted-foreground text-pretty">{s.text}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}

function StartSlide() {
  const router = useRouter()
  const { data: status, isLoading } = useOnboarding()
  const canSetUp = useCanSetUp()
  const canSample = useCan("settings:write")
  const restore = useSetOnboardingDismissed()
  const sample = useLoadSample()

  const start = () => {
    if (status?.dismissed) restore.mutate(false)
    router.push("/")
  }

  let sampleNote: string | null = null
  if (!canSample) sampleNote = "Only owners and admins can load sample data."
  else if (status?.sampleData.present) sampleNote = "Sample data is already loaded."
  else if (status && !status.sampleData.canLoad) sampleNote = "Sample data can only go into an empty install, and yours already has products or gateway accounts."

  return (
    <div className="space-y-8">
      <SlideHeading id="slide-2" eyebrow="Get started" title="How do you want to begin?">
        {canSetUp
          ? "Set up the real thing, or look around a made-up company first. Either way, the setup guide on your dashboard tracks what's left."
          : "Your dashboard shows payments for the products you can see. An owner or admin handles gateway keys and new products."}
      </SlideHeading>
      <div className="grid gap-4 md:grid-cols-2">
        <Choice
          icon={Rocket}
          title={canSetUp ? "Set up my install" : "Open my dashboard"}
          text={
            canSetUp
              ? "Set a public URL, connect a gateway, add a product and take a test payment. About ten minutes with your test keys at hand."
              : "See payments, products and webhook deliveries, and set which notifications you get."
          }
          action={
            <Button onClick={start} data-testid="tour-start-setup" className="w-full sm:w-auto">
              {canSetUp ? "Start setup" : "Go to dashboard"} <ArrowRight />
            </Button>
          }
          primary
        />
        <Choice
          icon={FlaskConical}
          title="Explore with sample data"
          text="Load a made-up company with three products and a year of payments. Nothing is sent to a gateway, and it's removed in one click."
          note={isLoading ? null : sampleNote}
          action={
            status?.sampleData.present ? (
              <Button variant="outline" onClick={() => router.push("/")} className="w-full sm:w-auto">
                Open dashboard <ArrowRight />
              </Button>
            ) : (
              <Button
                variant="outline"
                disabled={!canSample || !status?.sampleData.canLoad || sample.pending}
                onClick={() => sample.run(() => router.push("/"))}
                data-testid="tour-load-sample"
                className="w-full sm:w-auto"
              >
                {sample.pending ? <Spinner /> : <FlaskConical />} Load sample data
              </Button>
            )
          }
        />
      </div>
      <p className="text-xs text-muted-foreground">You can reopen this tour any time from Product tour in your account menu.</p>
    </div>
  )
}

function Choice({
  icon: Icon,
  title,
  text,
  note,
  action,
  primary,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  text: string
  note?: string | null
  action: React.ReactNode
  primary?: boolean
}) {
  return (
    <div className={cn("flex flex-col gap-4 rounded-2xl border bg-card p-6 shadow-card", primary && "border-primary/40 ring-1 ring-primary/15")}>
      <span className={cn("grid size-10 place-items-center rounded-xl", primary ? "bg-primary text-primary-foreground" : "bg-muted text-foreground")}>
        <Icon className="size-5" />
      </span>
      <div className="flex-1 space-y-1.5">
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        <p className="text-sm text-muted-foreground text-pretty">{text}</p>
        {note && <p className="text-xs text-muted-foreground italic">{note}</p>}
      </div>
      <div>{action}</div>
    </div>
  )
}
