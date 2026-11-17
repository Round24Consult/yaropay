"use client"

// YaroPay Enterprise License: see LICENSE.md in the parent folder.

import {
  ArrowLeft,
  Building2,
  CreditCard,
  LayoutDashboard,
  type LucideIcon,
  Mail,
  Plug,
  ReceiptText,
  ScrollText,
  Settings,
  Tags,
  Users,
} from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { ThemeToggle } from "@/components/layout/theme-toggle"
import { roleLabel, UserAvatar, UserMenuItems } from "@/components/layout/user-menu"
import { BrandMark } from "@/components/shared/brand-mark"
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar"
import { useMe } from "@/lib/auth"

interface ConsoleItem {
  title: string
  href: string
  icon: LucideIcon
  /** Other paths that belong to this item (a company's page belongs to Companies). */
  also?: string[]
}

/** The platform console's own menu. Every page needs a super admin with two-step sign-in. */
export const CONSOLE_NAV: { label: string; items: ConsoleItem[] }[] = [
  {
    label: "Platform",
    items: [
      { title: "Overview", href: "/platform", icon: LayoutDashboard },
      { title: "Companies", href: "/platform/companies", icon: Building2, also: ["/platform/workspaces"] },
      { title: "People", href: "/platform/people", icon: Users },
    ],
  },
  {
    label: "Money",
    items: [
      { title: "Plans & pricing", href: "/platform/pricing", icon: Tags },
      { title: "Invoices", href: "/platform/invoices", icon: ReceiptText },
      { title: "Billing", href: "/platform/billing", icon: CreditCard },
    ],
  },
  {
    label: "Configuration",
    items: [
      { title: "Gateways", href: "/platform/gateways", icon: Plug },
      { title: "Email", href: "/platform/email", icon: Mail },
      { title: "Settings", href: "/platform/settings", icon: Settings },
    ],
  },
  {
    label: "Records",
    items: [{ title: "Audit log", href: "/platform/audit", icon: ScrollText }],
  },
]

export function consoleItemActive(pathname: string, item: ConsoleItem) {
  if (item.href === "/platform") return pathname === "/platform"
  return [item.href, ...(item.also ?? [])].some((h) => pathname === h || pathname.startsWith(`${h}/`))
}

/** Replaces the company sidebar on every /platform page: no company switcher, no live/test switch. */
export function PlatformSidebar() {
  const pathname = usePathname()
  const me = useMe()
  const { state, isMobile, setOpenMobile } = useSidebar()
  const collapsed = state === "collapsed" && !isMobile
  const close = () => isMobile && setOpenMobile(false)

  return (
    <Sidebar collapsible="icon" variant="sidebar" data-testid="platform-sidebar">
      <SidebarHeader className="p-3">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild className="hover:bg-transparent active:bg-transparent">
              <Link href="/platform" onClick={close}>
                <BrandMark />
                <div className="grid min-w-0 flex-1 text-left leading-tight">
                  <span className="truncate text-sm font-semibold">YaroPay Platform</span>
                  <span className="truncate text-xs text-muted-foreground">Super admin console</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {CONSOLE_NAV.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton asChild isActive={consoleItemActive(pathname, item)} tooltip={item.title}>
                      <Link href={item.href} onClick={close} data-testid={`console-nav-${item.href.split("/")[2] ?? "overview"}`}>
                        <item.icon />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="gap-2 p-3">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip="Back to company dashboard">
              <Link href="/" onClick={close} data-testid="console-back">
                <ArrowLeft />
                <span>Back to company dashboard</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        {!collapsed && (
          <div className="flex items-center justify-between gap-1 rounded-xl border bg-background/60 p-1.5">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2 rounded-lg p-0.5 text-left outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring"
                  aria-label={`Account: ${me.name}`}
                >
                  <UserAvatar name={me.name} />
                  <span className="min-w-0 leading-tight">
                    <span className="block truncate text-xs font-medium">{me.name}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">Super admin · {roleLabel(me.role)} at {me.workspace.name}</span>
                  </span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" className="w-64">
                <UserMenuItems />
              </DropdownMenuContent>
            </DropdownMenu>
            <ThemeToggle />
          </div>
        )}
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
