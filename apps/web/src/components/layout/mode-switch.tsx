"use client"

import { useQueryClient } from "@tanstack/react-query"
import { useMode } from "@/lib/mode"
import { cn } from "@/lib/utils"

/** Test / Live data switch. Test mode shows sandbox connections and payments only. */
export function ModeSwitch({ className }: { className?: string }) {
  const { mode, setMode } = useMode()
  const qc = useQueryClient()
  return (
    <div
      role="radiogroup"
      aria-label="Data mode"
      className={cn("grid grid-cols-2 rounded-lg border bg-background p-0.5 text-xs font-medium", className)}
    >
      {(["live", "test"] as const).map((m) => (
        <button
          key={m}
          type="button"
          role="radio"
          aria-checked={mode === m}
          onClick={() => {
            setMode(m)
            qc.invalidateQueries()
          }}
          className={cn(
            "flex h-7 items-center justify-center gap-1.5 rounded-md px-2 capitalize transition-colors",
            mode === m ? "bg-secondary text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <span
            aria-hidden
            className={cn("size-1.5 rounded-full", m === "live" ? "bg-good" : "bg-warning", mode !== m && "opacity-40")}
          />
          {m}
        </button>
      ))}
    </div>
  )
}
