"use client"

import { ROLES } from "@yaropay/core/auth"
import { Bell, Compass, ListChecks, LogOut, ShieldCheck } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import * as React from "react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import { useCanSetUp } from "@/components/onboarding/setup-checklist"
import { useLogout, useOnboarding, useSetOnboardingDismissed } from "@/lib/api/hooks"
import { useMe } from "@/lib/auth"
import { initials } from "@/lib/format"
import { cn } from "@/lib/utils"

export function roleLabel(role: string) {
  return ROLES.find((r) => r.value === role)?.label ?? role
}

export function UserAvatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      className={cn(
        "grid size-7 shrink-0 place-items-center rounded-full bg-accent text-[11px] font-semibold text-accent-foreground",
        className,
      )}
      aria-hidden
    >
      {initials(name)}
    </span>
  )
}

/** Account items shared by the topbar avatar menu and the sidebar user card. */
export function UserMenuItems() {
  const me = useMe()
  const router = useRouter()
  const logout = useLogout()
  const [busy, setBusy] = React.useState(false)
  const signOut = async () => {
    setBusy(true)
    try {
      await logout.mutateAsync()
    } catch {
      toast.error("Could not reach the API. Your session will end when it expires.")
    }
    router.replace("/login")
  }
  return (
    <>
      <DropdownMenuLabel className="flex items-center gap-2.5 py-2 font-normal">
        <UserAvatar name={me.name} className="size-8" />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-sm font-medium text-foreground">{me.name}</p>
          <p className="truncate text-xs text-muted-foreground">{me.email}</p>
        </div>
        <Badge variant="secondary" className="shrink-0">
          {roleLabel(me.role)}
        </Badge>
      </DropdownMenuLabel>
      {me.productIds !== null && (
        <p className="px-2 pb-1.5 text-[11px] text-muted-foreground">
          Limited to {me.productIds.length} product{me.productIds.length === 1 ? "" : "s"}
        </p>
      )}
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <DropdownMenuItem asChild>
          <Link href="/settings?tab=security">
            <ShieldCheck /> Profile &amp; security
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings?tab=notifications">
            <Bell /> Notification settings
          </Link>
        </DropdownMenuItem>
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <GettingStartedItems />
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={(e) => (e.preventDefault(), signOut())} disabled={busy} data-testid="sign-out">
        <LogOut /> Sign out
      </DropdownMenuItem>
    </>
  )
}

function GettingStartedItems() {
  const router = useRouter()
  const canSetUp = useCanSetUp()
  const { data: status } = useOnboarding()
  const restore = useSetOnboardingDismissed()
  const unfinished = status && status.completed < status.total
  return (
    <DropdownMenuGroup>
      {canSetUp && unfinished && (
        <DropdownMenuItem
          data-testid="menu-getting-started"
          onSelect={() => {
            if (status.dismissed) restore.mutate(false)
            router.push("/")
          }}
        >
          <ListChecks /> Getting started
          <span className="ml-auto text-xs text-muted-foreground tabular-nums">
            {status.completed}/{status.total}
          </span>
        </DropdownMenuItem>
      )}
      <DropdownMenuItem asChild>
        <Link href="/welcome" data-testid="menu-tour">
          <Compass /> Product tour
        </Link>
      </DropdownMenuItem>
    </DropdownMenuGroup>
  )
}
