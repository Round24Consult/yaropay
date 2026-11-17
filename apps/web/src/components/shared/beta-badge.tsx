import { BETA_GATEWAY_NOTE } from "@yaropay/core/gateways/types"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

/** Marks a gateway built from its documentation that hasn't been confirmed with a real sandbox payment yet. */
export function BetaBadge({ className }: { className?: string }) {
  return (
    <Badge variant="outline" className={cn("cursor-help border-warning/40 text-warning-text", className)} title={BETA_GATEWAY_NOTE} aria-label={`Beta: ${BETA_GATEWAY_NOTE}`}>
      Beta
    </Badge>
  )
}
