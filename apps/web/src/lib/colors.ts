import type { ColorSlot } from "@yaropay/core/types"

/** CSS colour for a product's categorical slot. Follows the theme automatically. */
export function seriesVar(slot: ColorSlot | number) {
  return `var(--series-${slot})`
}

export const COLOR_SLOTS: ColorSlot[] = [1, 2, 3, 4, 5, 6, 7, 8]

/** Lowest slot not used by an existing product (fixed order, never cycled). */
export function nextFreeSlot(used: number[]): ColorSlot {
  return COLOR_SLOTS.find((s) => !used.includes(s)) ?? 8
}
