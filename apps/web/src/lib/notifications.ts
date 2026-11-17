"use client"

import { useQueryClient } from "@tanstack/react-query"
import type { AppNotification } from "@yaropay/core/notifications"
import { useRouter } from "next/navigation"
import * as React from "react"
import { toast } from "sonner"
import { API_BASE } from "@/lib/api/client"

/**
 * Listens to the API's server-sent events and refreshes notification queries
 * when one arrives. Returns false while the stream is down, so callers can
 * fall back to polling.
 */
export function useNotificationStream() {
  const qc = useQueryClient()
  const router = useRouter()
  const [live, setLive] = React.useState(false)

  React.useEffect(() => {
    if (typeof EventSource === "undefined") return
    // A refresh asked for while a load is still in flight would otherwise just wait for that load,
    // which may have started before the news arrived. Drop it and load again.
    const refresh = () => {
      void qc.cancelQueries({ queryKey: ["notifications"] }).then(() => qc.invalidateQueries({ queryKey: ["notifications"] }))
    }
    const source = new EventSource(`${API_BASE}/notifications/stream`, { withCredentials: true })
    const onNotification = (e: MessageEvent<string>) => {
      refresh()
      let n: AppNotification | null = null
      try {
        n = JSON.parse(e.data) as AppNotification
      } catch {
        return
      }
      if (n.severity === "info") return
      const show = n.severity === "critical" ? toast.error : toast.warning
      show(n.title, {
        description: n.body,
        action: n.link ? { label: "View", onClick: () => router.push(n.link!) } : undefined,
      })
    }
    source.addEventListener("notification", onNotification as EventListener)
    source.onopen = () => {
      setLive(true)
      // Anything created between the list fetch and this (re)connection never reached the stream: catch up now.
      refresh()
    }
    source.onerror = () => setLive(false)
    return () => {
      source.removeEventListener("notification", onNotification as EventListener)
      source.close()
    }
  }, [qc, router])

  return live
}
