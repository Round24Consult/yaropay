import type { ColorSlot } from "@yaropay/core/types"
import { seriesVar } from "@/lib/colors"
import { cn } from "@/lib/utils"

export function ProductDot({ slot, className }: { slot: ColorSlot | number; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block size-2 shrink-0 rounded-full", className)}
      style={{ backgroundColor: seriesVar(slot) }}
    />
  )
}

/** Product identity: coloured mark beside the name; the text stays in text colours. */
export function ProductChip({
  name,
  slot,
  className,
  size = "default",
}: {
  name: string
  slot: ColorSlot | number
  className?: string
  size?: "default" | "sm"
}) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-md border bg-background/60 font-medium text-foreground",
        size === "sm" ? "h-5 px-1.5 text-[11px]" : "h-6 px-2 text-xs",
        className,
      )}
    >
      <ProductDot slot={slot} className={size === "sm" ? "size-1.5" : undefined} />
      <span className="truncate">{name}</span>
    </span>
  )
}

/** Square product avatar using the product colour as a soft wash. */
export function ProductAvatar({ name, slot, className }: { name: string; slot: ColorSlot | number; className?: string }) {
  return (
    <span
      className={cn("relative grid size-9 shrink-0 place-items-center overflow-hidden rounded-lg text-sm font-semibold text-foreground", className)}
      aria-hidden
    >
      <span className="absolute inset-0 opacity-15" style={{ backgroundColor: seriesVar(slot) }} />
      <span className="absolute inset-x-0 bottom-0 h-0.5" style={{ backgroundColor: seriesVar(slot) }} />
      <span className="relative">{name.slice(0, 1).toUpperCase()}</span>
    </span>
  )
}
