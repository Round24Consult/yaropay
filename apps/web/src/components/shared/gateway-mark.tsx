import { getGateway } from "@yaropay/core/gateways/registry"
import { cn } from "@/lib/utils"

/**
 * Neutral monogram for a gateway. We deliberately do not ship third-party
 * logos; installs can drop official artwork into /public if they want it.
 */
export function GatewayMark({ gatewayId, className, size = "default" }: { gatewayId: string; className?: string; size?: "sm" | "default" | "lg" }) {
  const g = getGateway(gatewayId)
  return (
    <span
      title={g?.name}
      className={cn(
        "grid shrink-0 place-items-center rounded-md border bg-gradient-to-b from-background to-muted font-mono font-semibold tracking-tight text-foreground",
        size === "sm" && "size-5 text-[9px]",
        size === "default" && "size-7 text-[10px]",
        size === "lg" && "size-11 rounded-xl text-sm",
        className,
      )}
    >
      {g?.monogram ?? gatewayId.slice(0, 2).toUpperCase()}
    </span>
  )
}

export function gatewayName(id: string) {
  return getGateway(id)?.name ?? id
}
