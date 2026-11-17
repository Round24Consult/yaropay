import { CircleAlert, CircleCheck } from "lucide-react"
import { cn } from "@/lib/utils"

export function FormAlert({ tone = "error", children, className }: { tone?: "error" | "success" | "info"; children: React.ReactNode; className?: string }) {
  if (!children) return null
  const Icon = tone === "success" ? CircleCheck : CircleAlert
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex gap-2 rounded-lg border px-3 py-2.5 text-sm",
        tone === "error" && "border-critical/30 bg-critical/8 text-critical-text",
        tone === "success" && "border-good/30 bg-good/8 text-good-text",
        tone === "info" && "border-border bg-muted/50 text-muted-foreground",
        className,
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0">{children}</div>
    </div>
  )
}
