"use client"

import { ArrowRightLeft, CheckCircle2, CircleDot, CornerDownRight, Globe, Send, ShieldCheck, Webhook, XCircle } from "lucide-react"
import type { TimelineStep, TimelineStepKind } from "@yaropay/core/types"
import { formatDateTime } from "@/lib/format"
import { cn } from "@/lib/utils"

const ICONS: Record<TimelineStepKind, React.ElementType> = {
  initialized: CircleDot,
  redirected: Globe,
  callback: CornerDownRight,
  verified: ShieldCheck,
  webhook_received: Webhook,
  routed: ArrowRightLeft,
  forwarded: Send,
  failed: XCircle,
}

/** The path a payment took: product → gateway → YaroPay → product. */
export function RoutingTimeline({ steps }: { steps: TimelineStep[] }) {
  return (
    <ol className="relative space-y-0">
      {steps.map((s, i) => {
        const Icon = ICONS[s.kind]
        const last = i === steps.length - 1
        return (
          <li key={`${s.kind}-${i}`} className="relative flex gap-3 pb-5 last:pb-0">
            {!last && <span className="absolute top-7 bottom-0 left-[13px] w-px bg-border" aria-hidden />}
            <span
              className={cn(
                "relative z-10 grid size-7 shrink-0 place-items-center rounded-full ring-4 ring-background",
                s.ok ? "bg-secondary text-foreground" : "bg-critical/10 text-critical-text",
                s.kind === "routed" && "bg-primary text-primary-foreground",
              )}
            >
              <Icon className="size-3.5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <p className="text-sm font-medium">
                  {s.title}
                  {!s.ok && <span className="sr-only"> (problem)</span>}
                </p>
                <time className="text-[11px] text-muted-foreground tabular">{formatDateTime(s.at)}</time>
              </div>
              {s.detail && <p className="mt-0.5 font-mono text-[11.5px] break-all text-muted-foreground">{s.detail}</p>}
            </div>
          </li>
        )
      })}
      {steps.length > 0 && steps[steps.length - 1].ok && steps[steps.length - 1].kind === "forwarded" && (
        <li className="mt-3 flex items-center gap-2 text-xs text-good-text">
          <CheckCircle2 className="size-3.5" /> Reached the product
        </li>
      )}
    </ol>
  )
}
