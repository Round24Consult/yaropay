"use client"

import { FlaskConical, Search } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import * as React from "react"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Kbd } from "@/components/ui/kbd"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { useConnections, useProducts } from "@/lib/api/hooks"
import { useMe } from "@/lib/auth"
import { useMode } from "@/lib/mode"
import { CommandMenu } from "./command-menu"
import { NotificationBell } from "./notification-bell"
import { UserAvatar, UserMenuItems } from "./user-menu"

const LABELS: Record<string, string> = {
  products: "Products",
  transactions: "Transactions",
  webhooks: "Webhooks",
  apps: "Apps",
  settings: "Settings",
  new: "New product",
  platform: "Platform",
  pricing: "Plans & pricing",
  audit: "Audit log",
  people: "People",
}

function useCrumbs() {
  const pathname = usePathname()
  const { data: products } = useProducts()
  const { data: connections } = useConnections()
  const parts = pathname.split("/").filter(Boolean)
  if (parts.length === 0) return [{ href: "/", label: "Dashboard" }]
  return parts.map((part, i) => {
    const href = `/${parts.slice(0, i + 1).join("/")}`
    let label = LABELS[part] ?? part
    if (parts[0] === "products" && i === 1 && part !== "new") label = products?.find((p) => p.id === part)?.name ?? "Product"
    if (parts[0] === "apps" && i === 1) {
      const c = connections?.find((x) => x.id === part)
      label = c ? c.label : "Account"
    }
    // The platform console has no /platform/workspaces page: that crumb goes back to the list.
    if (parts[0] === "platform" && part === "workspaces") return { href: "/platform", label: "Companies" }
    if (parts[0] === "platform" && parts[1] === "workspaces" && i === 2) label = "Company"
    return { href, label }
  })
}

export function Topbar() {
  const me = useMe()
  const crumbs = useCrumbs()
  const { mode, setMode } = useMode()
  const [open, setOpen] = React.useState(false)

  return (
    <>
      {mode === "test" && (
        <div className="flex items-center justify-center gap-2 border-b border-warning/30 bg-warning/10 px-4 py-1.5 text-xs font-medium text-warning-text">
          <FlaskConical className="size-3.5" aria-hidden />
          Test mode: you are looking at sandbox payments only.
          <button type="button" className="underline underline-offset-2" onClick={() => setMode("live")}>
            Switch to live
          </button>
        </div>
      )}
      <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/70 md:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mr-1 !h-4" />
        <Breadcrumb className="min-w-0">
          <BreadcrumbList className="flex-nowrap">
            {crumbs.map((c, i) => (
              <React.Fragment key={c.href}>
                {i > 0 && <BreadcrumbSeparator className="hidden sm:block" />}
                <BreadcrumbItem className={i < crumbs.length - 1 ? "hidden sm:inline-flex" : "min-w-0"}>
                  {i === crumbs.length - 1 ? (
                    <BreadcrumbPage className="truncate">{c.label}</BreadcrumbPage>
                  ) : (
                    <BreadcrumbLink asChild>
                      <Link href={c.href}>{c.label}</Link>
                    </BreadcrumbLink>
                  )}
                </BreadcrumbItem>
              </React.Fragment>
            ))}
          </BreadcrumbList>
        </Breadcrumb>
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            className="h-8 w-9 justify-center gap-2 px-0 text-muted-foreground sm:w-64 sm:justify-start sm:px-2.5"
            onClick={() => setOpen(true)}
            aria-label="Search"
          >
            <Search className="size-4" />
            <span className="hidden flex-1 text-left text-sm font-normal sm:inline">Search or jump to…</span>
            <Kbd className="hidden sm:inline-flex">⌘K</Kbd>
          </Button>
          <NotificationBell />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-8 rounded-full" aria-label={`Account: ${me.name}`} data-testid="user-menu">
                <UserAvatar name={me.name} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
              <UserMenuItems />
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      <CommandMenu open={open} onOpenChange={setOpen} />
    </>
  )
}
