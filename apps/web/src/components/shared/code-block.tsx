"use client"

import * as React from "react"
import { CopyButton } from "@/components/shared/copy-field"
import { cn } from "@/lib/utils"

export function CodeBlock({
  tabs,
  className,
}: {
  tabs: { label: string; code: string }[]
  className?: string
}) {
  const [active, setActive] = React.useState(0)
  const current = tabs[active]
  return (
    <div className={cn("overflow-hidden rounded-xl border bg-zinc-950 text-zinc-100 dark:bg-black/40", className)}>
      <div className="flex items-center gap-1 border-b border-white/10 px-2 py-1.5">
        {tabs.map((t, i) => (
          <button
            key={t.label}
            type="button"
            onClick={() => setActive(i)}
            className={cn(
              "rounded-md px-2 py-1 text-xs font-medium transition-colors",
              i === active ? "bg-white/10 text-white" : "text-zinc-400 hover:text-zinc-200",
            )}
          >
            {t.label}
          </button>
        ))}
        <CopyButton value={current.code} label={`${current.label} snippet`} className="ml-auto text-zinc-400 hover:bg-white/10 hover:text-white" />
      </div>
      <pre className="max-h-96 overflow-auto p-4 font-mono text-[12.5px] leading-relaxed">
        <code>{current.code}</code>
      </pre>
    </div>
  )
}
