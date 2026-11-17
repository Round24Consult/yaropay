import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react"
import { formatPercent } from "@yaropay/core/money"
import { cn } from "@/lib/utils"

/** Signed change vs the previous period. Colour = direction x whether up is good. */
export function Delta({ value, upIsGood = true, className }: { value: number | null; upIsGood?: boolean; className?: string }) {
  if (value === null) {
    return <span className={cn("text-xs text-muted-foreground", className)}>new</span>
  }
  const flat = Math.abs(value) < 0.0005
  const good = flat ? null : value > 0 === upIsGood
  const Icon = flat ? Minus : value > 0 ? ArrowUpRight : ArrowDownRight
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-xs font-medium tabular",
        good === null ? "text-muted-foreground" : good ? "text-good-text" : "text-critical-text",
        className,
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {flat ? "0%" : formatPercent(Math.abs(value))}
      <span className="sr-only">{value > 0 ? "increase" : "decrease"}</span>
    </span>
  )
}
