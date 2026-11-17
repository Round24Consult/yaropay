"use client"

import type { AppNotification, NotificationSeverity } from "@yaropay/core/notifications"
import { Bell, BellOff, CheckCheck, CircleAlert, Info, Settings2, TriangleAlert } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import * as React from "react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useMarkAllNotificationsRead, useMarkNotificationRead, useNotifications } from "@/lib/api/hooks"
import { formatRelative } from "@/lib/format"
import { useNotificationStream } from "@/lib/notifications"
import { cn } from "@/lib/utils"

const SEVERITY: Record<NotificationSeverity, { icon: React.ElementType; className: string; label: string }> = {
  info: { icon: Info, className: "bg-muted text-muted-foreground", label: "Info" },
  warning: { icon: TriangleAlert, className: "bg-warning/12 text-warning-text", label: "Warning" },
  critical: { icon: CircleAlert, className: "bg-critical/10 text-critical-text", label: "Critical" },
}

const PAGE = 15

export function NotificationBell() {
  const router = useRouter()
  const live = useNotificationStream()
  const [open, setOpen] = React.useState(false)
  const [pageSize, setPageSize] = React.useState(PAGE)
  const { data, isLoading } = useNotifications({ page: 1, pageSize }, { poll: !live })
  const markRead = useMarkNotificationRead()
  const markAll = useMarkAllNotificationsRead()
  const unread = data?.unread ?? 0

  const openItem = (n: AppNotification) => {
    if (!n.readAt) markRead.mutate(n.id)
    if (n.link) {
      setOpen(false)
      router.push(n.link)
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative size-8 text-muted-foreground"
          aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
          data-testid="notification-bell"
        >
          <Bell className="size-4" />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] leading-none font-semibold text-primary-foreground tabular ring-2 ring-background">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(24rem,calc(100vw-2rem))] gap-0 p-0">
        <div className="flex items-center justify-between gap-2 border-b px-3.5 py-2.5">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold">Notifications</p>
            {unread > 0 && <span className="rounded-full bg-primary/10 px-1.5 text-[11px] font-medium text-primary tabular">{unread} new</span>}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            disabled={!unread || markAll.isPending}
            onClick={() => markAll.mutate()}
          >
            <CheckCheck /> Mark all read
          </Button>
        </div>
        <div className="max-h-[min(28rem,70vh)] overflow-y-auto overscroll-contain">
          {isLoading ? (
            <div className="space-y-3 p-3.5">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex gap-3">
                  <div className="size-7 animate-pulse rounded-lg bg-muted" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3.5 w-3/4 animate-pulse rounded bg-muted" />
                    <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
                  </div>
                </div>
              ))}
            </div>
          ) : !data?.rows.length ? (
            <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
              <span className="grid size-10 place-items-center rounded-xl bg-muted text-muted-foreground">
                <BellOff className="size-5" aria-hidden />
              </span>
              <p className="text-sm font-medium">You&apos;re all caught up</p>
              <p className="text-xs text-muted-foreground">Failed deliveries, unrouted events and security alerts show up here.</p>
            </div>
          ) : (
            <ul className="divide-y">
              {data.rows.map((n) => {
                const s = SEVERITY[n.severity]
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => openItem(n)}
                      className={cn(
                        "flex w-full gap-3 px-3.5 py-3 text-left transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none",
                        !n.readAt && "bg-primary/[0.03]",
                      )}
                    >
                      <span className={cn("mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg", s.className)}>
                        <s.icon className="size-3.5" aria-label={s.label} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-start gap-2">
                          <span className={cn("flex-1 text-sm leading-snug", !n.readAt && "font-medium")}>{n.title}</span>
                          {!n.readAt && <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" aria-label="Unread" />}
                        </span>
                        <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">{n.body}</span>
                        <span className="mt-1 block text-[11px] text-muted-foreground">{formatRelative(n.createdAt)}</span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
          {data && data.total > data.rows.length && (
            <div className="border-t p-2">
              <Button variant="ghost" size="sm" className="w-full text-xs" onClick={() => setPageSize((s) => s + PAGE)}>
                Show older
              </Button>
            </div>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 border-t px-3.5 py-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className={cn("size-1.5 rounded-full", live ? "bg-good" : "bg-muted-foreground/50")} aria-hidden />
            {live ? "Live" : "Checking every 30s"}
          </span>
          <Link href="/settings?tab=notifications" onClick={() => setOpen(false)} className="inline-flex items-center gap-1 font-medium text-foreground hover:underline">
            <Settings2 className="size-3.5" /> Settings
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  )
}
