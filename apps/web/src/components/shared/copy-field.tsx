"use client"

import { Check, Copy } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export function useCopy() {
  const [copied, setCopied] = React.useState(false)
  const copy = React.useCallback(async (value: string, label?: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      toast.success(label ? `${label} copied` : "Copied")
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error("Copy failed. Select the text and copy it manually.")
    }
  }, [])
  return { copied, copy }
}

export function CopyButton({ value, label, className }: { value: string; label?: string; className?: string }) {
  const { copied, copy } = useCopy()
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className={cn("shrink-0 text-muted-foreground", className)}
      onClick={() => copy(value, label)}
      aria-label={label ? `Copy ${label}` : "Copy"}
    >
      {copied ? <Check className="text-good-text" /> : <Copy />}
    </Button>
  )
}

/** A labelled, monospaced value with a copy button: used for every generated URL and key. */
export function CopyField({
  label,
  value,
  hint,
  badge,
  className,
  testId,
}: {
  label: string
  value: string
  hint?: React.ReactNode
  badge?: React.ReactNode
  className?: string
  testId?: string
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        {label}
        {badge}
      </div>
      <div className="flex min-w-0 items-center gap-1 rounded-lg border bg-muted/40 py-1 pr-1 pl-3">
        <code data-testid={testId} className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-foreground" title={value}>
          {value}
        </code>
        <CopyButton value={value} label={label} />
      </div>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}
