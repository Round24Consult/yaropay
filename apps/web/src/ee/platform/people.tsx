"use client"

// YaroPay Enterprise License: see LICENSE.md in the parent folder.

import type { PlatformUserRow } from "@yaropay/core/platform"
import { Loader2, MoreHorizontal, Search, ShieldCheck } from "lucide-react"
import Link from "next/link"
import * as React from "react"
import { toast } from "sonner"
import { roleLabel } from "@/components/layout/user-menu"
import { Panel } from "@/components/shared/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useMe } from "@/lib/auth"
import { formatDate, formatRelative } from "@/lib/format"
import { type UserAction, usePlatformUsers, useUserAction } from "./hooks"
import { isCancelled, PlatformShell, useGuarded } from "./platform-shell"

const CONFIRM: Record<UserAction, { title: (u: PlatformUserRow) => string; text: string; button: string; done: (u: PlatformUserRow) => string; danger?: boolean }> = {
  disable: {
    title: (u) => `Disable ${u.name}'s account?`,
    text: "They're signed out everywhere and can't sign in to any company until you re-enable the account. Each of their companies' audit logs records it.",
    button: "Disable account",
    done: (u) => `${u.name} can't sign in now`,
    danger: true,
  },
  enable: { title: (u) => `Re-enable ${u.name}'s account?`, text: "They can sign in again with their password.", button: "Re-enable", done: (u) => `${u.name} can sign in again` },
  "password-reset": {
    title: (u) => `Send ${u.name} a password reset?`,
    text: "They get an email with a link to choose a new password. It works for one hour. Two-step sign-in, if on, still applies.",
    button: "Send link",
    done: (u) => `Reset link sent to ${u.email}`,
  },
  "reset-two-step": {
    title: (u) => `Turn off two-step sign-in for ${u.name}?`,
    text: "Only for someone who lost both their phone and their recovery codes, and whose identity you've checked. They're signed out everywhere and can turn it on again after signing in.",
    button: "Turn it off",
    done: (u) => `Two-step sign-in is off for ${u.name}`,
    danger: true,
  },
}

/** Every account on the platform, with the companies it belongs to. */
export function PeoplePage() {
  return (
    <PlatformShell title="People" description="Every account on YaroPay Cloud and the companies it belongs to. Granting super admin is only possible from the server.">
      <People />
    </PlatformShell>
  )
}

/** Inside the shell, so changes can ask for the password and code again. */
function People() {
  const me = useMe()
  const [q, setQ] = React.useState("")
  const [search, setSearch] = React.useState("")
  const [page, setPage] = React.useState(1)
  const { data, isLoading } = usePlatformUsers({ q: search || undefined, page })
  const action = useUserAction()
  const guarded = useGuarded()
  const [confirm, setConfirm] = React.useState<{ user: PlatformUserRow; action: UserAction } | null>(null)

  React.useEffect(() => {
    const id = setTimeout(() => {
      setSearch(q.trim())
      setPage(1)
    }, 250)
    return () => clearTimeout(id)
  }, [q])

  const pages = data ? Math.max(1, Math.ceil(data.total / 50)) : 1
  return (
    <>
      <Panel className="overflow-hidden">
        <div className="p-4">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or email" className="pl-9" aria-label="Search people" />
          </div>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">Person</TableHead>
                <TableHead>Companies</TableHead>
                <TableHead className="hidden md:table-cell">Two-step</TableHead>
                <TableHead className="hidden lg:table-cell">Last active</TableHead>
                <TableHead className="pr-5" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading &&
                Array.from({ length: 4 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={5} className="px-5">
                      <Skeleton className="h-6" />
                    </TableCell>
                  </TableRow>
                ))}
              {data?.rows.map((u) => (
                <TableRow key={u.id} className={u.disabled ? "opacity-70" : undefined} data-testid={`person-${u.email}`}>
                  <TableCell className="pl-5">
                    <p className="flex flex-wrap items-center gap-1.5 font-medium">
                      {u.name}
                      {u.platformRole === "super_admin" && <Badge variant="secondary">Super admin</Badge>}
                      {u.disabled && <Badge variant="destructive">Disabled</Badge>}
                      {!u.emailVerified && <Badge variant="outline">Email not confirmed</Badge>}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {u.email} · joined {formatDate(u.createdAt)}
                    </p>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1.5">
                      {u.companies.length === 0 && <span className="text-xs text-muted-foreground">None</span>}
                      {u.companies.map((c) => (
                        <Link key={c.id} href={`/platform/workspaces/${c.id}`} className="hover:underline">
                          <Badge variant="outline" className={c.removed ? "line-through" : undefined}>
                            {c.name} · {roleLabel(c.role)}
                          </Badge>
                        </Link>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{u.mfaEnabled ? <ShieldCheck className="size-4 text-good-text" aria-label="On" /> : <span className="text-xs text-muted-foreground">Off</span>}</TableCell>
                  <TableCell className="hidden text-xs text-muted-foreground lg:table-cell">{u.lastActiveAt ? formatRelative(u.lastActiveAt) : "Never"}</TableCell>
                  <TableCell className="pr-5 text-right">
                    {u.id !== me.id && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="icon-sm" variant="ghost" aria-label={`Actions for ${u.name}`} data-testid={`person-actions-${u.email}`}>
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => setConfirm({ user: u, action: "password-reset" })}>Send password reset</DropdownMenuItem>
                          {u.mfaEnabled && <DropdownMenuItem onSelect={() => setConfirm({ user: u, action: "reset-two-step" })}>Turn off two-step sign-in</DropdownMenuItem>}
                          {u.platformRole !== "super_admin" && (
                            <>
                              <DropdownMenuSeparator />
                              {u.disabled ? (
                                <DropdownMenuItem onSelect={() => setConfirm({ user: u, action: "enable" })}>Re-enable account</DropdownMenuItem>
                              ) : (
                                <DropdownMenuItem className="text-destructive" onSelect={() => setConfirm({ user: u, action: "disable" })}>
                                  Disable account
                                </DropdownMenuItem>
                              )}
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {data && data.rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                    No one matches.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        {pages > 1 && (
          <div className="flex items-center justify-between border-t px-5 py-3 text-sm text-muted-foreground">
            <span>
              Page {page} of {pages} · {data?.total} people
            </span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </div>
          </div>
        )}
      </Panel>
      <Dialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent>
          {confirm && (
            <>
              <DialogHeader>
                <DialogTitle>{CONFIRM[confirm.action].title(confirm.user)}</DialogTitle>
                <DialogDescription>{CONFIRM[confirm.action].text}</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setConfirm(null)}>
                  Cancel
                </Button>
                <Button
                  variant={CONFIRM[confirm.action].danger ? "destructive" : "default"}
                  disabled={action.isPending}
                  onClick={async () => {
                    try {
                      await guarded(() => action.mutateAsync({ userId: confirm.user.id, action: confirm.action }))
                      toast.success(CONFIRM[confirm.action].done(confirm.user))
                      setConfirm(null)
                    } catch (err) {
                      if (!isCancelled(err)) toast.error(err instanceof Error ? err.message : "Could not do that")
                    }
                  }}
                  data-testid="confirm-person-action"
                >
                  {action.isPending && <Loader2 className="animate-spin" />}
                  {CONFIRM[confirm.action].button}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
