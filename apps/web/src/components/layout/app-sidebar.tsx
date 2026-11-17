"use client"

import { BookOpen, Check, ChevronsUpDown, Plus } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { BrandMark } from "@/components/shared/brand-mark"
import { ProductDot } from "@/components/shared/product-chip"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar"
import { useDeliveries, useProducts, useSettings, useSwitchWorkspace } from "@/lib/api/hooks"
import { useCan, useHasAllProducts, useMe } from "@/lib/auth"
import { useMode } from "@/lib/mode"
import { site } from "@/lib/site"
import { ModeSwitch } from "./mode-switch"
import { isActive, NAV, PLATFORM_NAV, SETTINGS_NAV } from "./nav"
import { ThemeToggle } from "./theme-toggle"
import { roleLabel, UserAvatar, UserMenuItems } from "./user-menu"

export function AppSidebar() {
  const pathname = usePathname()
  const me = useMe()
  const canSettings = useCan("settings:read")
  const canWebhooks = useCan("webhooks:read")
  const canWriteProducts = useCan("products:write")
  const allProducts = useHasAllProducts()
  const canCreateProduct = canWriteProducts && allProducts
  const { data: settings } = useSettings({ enabled: canSettings })
  const { data: products } = useProducts()
  const { mode } = useMode()
  const { data: failing } = useDeliveries(
    { mode, state: ["failed", "retrying"], pageSize: 1, sinceDays: 7 },
    { enabled: canWebhooks },
  )
  const switchWorkspace = useSwitchWorkspace()
  const { state, isMobile, setOpenMobile } = useSidebar()
  const collapsed = state === "collapsed" && !isMobile
  const failingCount = (failing?.counts.failed ?? 0) + (failing?.counts.retrying ?? 0)
  const close = () => isMobile && setOpenMobile(false)

  return (
    <Sidebar collapsible="icon" variant="sidebar">
      <SidebarHeader className="gap-3 p-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent">
              <BrandMark />
              <div className="grid min-w-0 flex-1 text-left leading-tight">
                <span className="truncate text-sm font-semibold">{settings?.platformName ?? site.name}</span>
                <span className="truncate text-xs text-muted-foreground" data-testid="current-workspace">{me.workspace.name}</span>
              </div>
              <ChevronsUpDown className="ml-auto size-4 text-muted-foreground" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-60" align="start">
            <DropdownMenuLabel className="text-xs text-muted-foreground">{me.workspaces.length > 1 ? "Workspaces" : "Workspace"}</DropdownMenuLabel>
            {me.workspaces.map((w) => (
              <DropdownMenuItem
                key={w.id}
                data-testid={`workspace-${w.id}`}
                onSelect={() => {
                  if (w.id !== me.workspace.id) switchWorkspace.mutate(w.id)
                }}
              >
                <span className="grid size-6 shrink-0 place-items-center rounded-md bg-primary/10 text-[11px] font-semibold text-primary">
                  {w.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1 truncate">{w.name}</span>
                {w.id === me.workspace.id ? <Check className="size-4" /> : <span className="text-[11px] text-muted-foreground">{roleLabel(w.role)}</span>}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled>
              <span className="text-xs text-muted-foreground">v0.1.0 · {settings?.baseUrl?.replace(/^https?:\/\//, "")}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {!collapsed && <ModeSwitch />}
      </SidebarHeader>

      <SidebarContent>
        {NAV.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton asChild isActive={isActive(pathname, item.href)} tooltip={item.title}>
                      <Link href={item.href} onClick={close}>
                        <item.icon />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                    {item.href === "/webhooks" && failingCount > 0 && (
                      <SidebarMenuBadge className="rounded-full bg-critical/10 text-critical-text" aria-label={`${failingCount} deliveries need attention this week`}>
                        {failingCount}
                      </SidebarMenuBadge>
                    )}
                    {item.href === "/products" && products && products.length > 0 && (
                      <SidebarMenuSub>
                        {products.map((p) => (
                          <SidebarMenuSubItem key={p.id}>
                            <SidebarMenuSubButton asChild isActive={pathname === `/products/${p.id}`}>
                              <Link href={`/products/${p.id}`} onClick={close}>
                                <ProductDot slot={p.colorSlot} />
                                <span>{p.name}</span>
                              </Link>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        ))}
                        {canCreateProduct && (
                          <SidebarMenuSubItem>
                            <SidebarMenuSubButton asChild>
                              <Link href="/products/new" onClick={close} className="text-muted-foreground">
                                <Plus />
                                <span>New product</span>
                              </Link>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        )}
                      </SidebarMenuSub>
                    )}
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="gap-2 p-3">
        <SidebarMenu>
          {me.platformRole === "super_admin" && (
            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={isActive(pathname, PLATFORM_NAV.href)} tooltip={PLATFORM_NAV.title}>
                <Link href={PLATFORM_NAV.href} onClick={close} data-testid="nav-platform">
                  <PLATFORM_NAV.icon />
                  <span>{PLATFORM_NAV.title}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
          <SidebarMenuItem>
            <SidebarMenuButton asChild isActive={isActive(pathname, SETTINGS_NAV.href)} tooltip={SETTINGS_NAV.title}>
              <Link href={SETTINGS_NAV.href} onClick={close}>
                <SETTINGS_NAV.icon />
                <span>{SETTINGS_NAV.title}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip="Documentation">
              <a href={site.repo} target="_blank" rel="noreferrer">
                <BookOpen />
                <span>Documentation</span>
              </a>
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
                    <span className="block truncate text-[11px] text-muted-foreground">{roleLabel(me.role)}</span>
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
