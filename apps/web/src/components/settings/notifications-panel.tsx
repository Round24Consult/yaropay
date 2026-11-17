"use client"

import {
  NOTIFICATION_TYPES,
  type NotificationPreference,
  type NotificationTypeDefinition,
} from "@yaropay/core/notifications"
import { Bell, Mail } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"
import { Panel, PanelHeader } from "@/components/shared/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { useAuthState, useNotificationPreferences, useUpdateNotificationPreferences } from "@/lib/api/hooks"
import { useCan } from "@/lib/auth"

const CATEGORY_LABELS: Record<NotificationTypeDefinition["category"], string> = {
  webhooks: "Webhooks",
  gateways: "Gateways",
  security: "Security",
  team: "Team",
}

export function NotificationsPanel() {
  const { data, isLoading } = useNotificationPreferences()
  const { data: state } = useAuthState()
  const save = useUpdateNotificationPreferences()
  const canSettings = useCan("settings:write")
  const [draft, setDraft] = React.useState<NotificationPreference[] | null>(null)
  const prefs = draft ?? data ?? []

  const set = (type: NotificationPreference["type"], channel: "inApp" | "email", value: boolean) => {
    const next = prefs.map((p) => (p.type === type ? { ...p, [channel]: value } : p))
    setDraft(next)
    save.mutate(next, {
      onSuccess: () => setDraft(null),
      onError: (e) => {
        setDraft(null)
        toast.error(e.message || "Could not save your preferences")
      },
    })
  }

  const groups = (Object.keys(CATEGORY_LABELS) as NotificationTypeDefinition["category"][])
    .map((category) => ({
      category,
      items: NOTIFICATION_TYPES.filter((t) => t.category === category)
        .map((def) => ({ def, pref: prefs.find((p) => p.type === def.type) }))
        .filter((x): x is { def: NotificationTypeDefinition; pref: NotificationPreference } => !!x.pref),
    }))
    .filter((g) => g.items.length)

  return (
    <Panel className="overflow-hidden">
      <PanelHeader
        title="Your notifications"
        description="Choose how you hear about events. You only see the types your role can act on."
        actions={save.isPending ? <span className="text-xs text-muted-foreground">Saving…</span> : null}
      />
      {state && !state.emailEnabled && (
        <p className="mx-5 mt-3 rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          Email is not configured on this install yet, so email notifications are saved but not sent.
        </p>
      )}
      <div className="mt-3">
        <div className="grid grid-cols-[minmax(0,1fr)_4.5rem_4.5rem] items-center gap-x-2 border-y bg-muted/30 px-5 py-2 text-xs font-medium text-muted-foreground">
          <span>Event</span>
          <span className="flex items-center justify-center gap-1">
            <Bell className="size-3.5" aria-hidden /> In-app
          </span>
          <span className="flex items-center justify-center gap-1">
            <Mail className="size-3.5" aria-hidden /> Email
          </span>
        </div>
        {isLoading ? (
          <div className="space-y-3 p-5">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : (
          groups.map((g) => (
            <div key={g.category}>
              <p className="px-5 pt-4 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{CATEGORY_LABELS[g.category]}</p>
              <ul>
                {g.items.map(({ def, pref }) => (
                  <li key={def.type} className="grid grid-cols-[minmax(0,1fr)_4.5rem_4.5rem] items-center gap-x-2 px-5 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{def.label}</p>
                      <p className="text-xs text-muted-foreground">{def.description}</p>
                    </div>
                    <div className="flex justify-center">
                      <Switch
                        checked={pref.inApp}
                        onCheckedChange={(v) => set(def.type, "inApp", v)}
                        aria-label={`${def.label}: in-app`}
                      />
                    </div>
                    <div className="flex justify-center">
                      <Switch
                        checked={pref.email}
                        onCheckedChange={(v) => set(def.type, "email", v)}
                        aria-label={`${def.label}: email`}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </div>
      <p className="border-t px-5 py-3 text-xs text-muted-foreground">
        {canSettings
          ? "Failed deliveries, rejected signatures and gateway errors also go to the team alerts webhook set under General."
          : "Your admins may also route critical alerts to a team channel."}
      </p>
    </Panel>
  )
}
