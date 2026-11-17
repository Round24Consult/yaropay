"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Eye, Loader2 } from "lucide-react"
import { api, setActiveWorkspace } from "@/lib/api/client"
import { useMe } from "@/lib/auth"
import { navigateAfterAuth } from "@/lib/forms"

/** Shown while a YaroPay super admin looks at this company in a read-only support view. */
export function SupportBanner() {
  const me = useMe()
  const qc = useQueryClient()
  const end = useMutation({ mutationFn: () => api<{ ok: true }>("/auth/support/end", { method: "POST" }) })
  if (!me.support) return null
  const viewed = me.workspace.id
  const until = new Date(me.support.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-primary/30 bg-primary/10 px-4 py-2 text-sm md:px-6" role="status" data-testid="support-banner">
      <Eye className="size-4 shrink-0 text-primary" aria-hidden />
      <span className="font-medium">Support view of {me.workspace.name}: read-only until {until}.</span>
      <span className="min-w-0 truncate text-muted-foreground">{me.support.reason}</span>
      <button
        type="button"
        className="ml-auto inline-flex items-center gap-1.5 font-medium underline underline-offset-2"
        disabled={end.isPending}
        onClick={async () => {
          await end.mutateAsync().catch(() => undefined)
          qc.clear()
          setActiveWorkspace(null)
          // A full reload: the session is in a different company now.
          navigateAfterAuth(`/platform/workspaces/${viewed}`)
        }}
        data-testid="end-support"
      >
        {end.isPending && <Loader2 className="size-3.5 animate-spin" />}
        End support view
      </button>
    </div>
  )
}
