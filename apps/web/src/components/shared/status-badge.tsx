import { CircleAlert, CircleCheck, CircleDashed, CircleX, Clock3, Hourglass, RotateCcw, Undo2 } from "lucide-react"
import type { DeliveryState, TransactionStatus } from "@yaropay/core/types"
import { STATUS_LABELS } from "@/lib/format"
import { cn } from "@/lib/utils"

type Tone = "good" | "warning" | "critical" | "neutral" | "serious"

const toneClass: Record<Tone, string> = {
  good: "text-good-text bg-good/10 ring-good/25",
  warning: "text-warning-text bg-warning/12 ring-warning/35",
  serious: "text-serious-text bg-serious/12 ring-serious/30",
  critical: "text-critical-text bg-critical/10 ring-critical/25",
  neutral: "text-muted-foreground bg-muted ring-border",
}

/** Status always ships with an icon and a label, never colour alone. */
export function Pill({ tone, icon: Icon, children, className }: { tone: Tone; icon: React.ElementType; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex h-6 items-center gap-1 rounded-full px-2 text-xs font-medium ring-1 ring-inset whitespace-nowrap", toneClass[tone], className)}>
      <Icon className="size-3.5" aria-hidden />
      {children}
    </span>
  )
}

const TX: Record<TransactionStatus, { tone: Tone; icon: React.ElementType }> = {
  success: { tone: "good", icon: CircleCheck },
  failed: { tone: "critical", icon: CircleX },
  abandoned: { tone: "neutral", icon: CircleDashed },
  pending: { tone: "warning", icon: Clock3 },
  reversed: { tone: "serious", icon: Undo2 },
}

export function TransactionStatusBadge({ status, className }: { status: TransactionStatus; className?: string }) {
  const s = TX[status]
  return (
    <Pill tone={s.tone} icon={s.icon} className={className}>
      {STATUS_LABELS[status]}
    </Pill>
  )
}

const DL: Record<DeliveryState, { tone: Tone; icon: React.ElementType; label: string }> = {
  pending: { tone: "neutral", icon: Hourglass, label: "Queued" },
  delivered: { tone: "good", icon: CircleCheck, label: "Delivered" },
  retrying: { tone: "warning", icon: RotateCcw, label: "Retrying" },
  failed: { tone: "critical", icon: CircleAlert, label: "Failed" },
}

export function DeliveryBadge({ state, className }: { state: DeliveryState; className?: string }) {
  const s = DL[state]
  return (
    <Pill tone={s.tone} icon={s.icon} className={className}>
      {s.label}
    </Pill>
  )
}
