import { ArrowLeftRight, Blocks, Boxes, Building2, LayoutDashboard, type LucideIcon, Settings, Webhook } from "lucide-react"

export interface NavItem {
  title: string
  href: string
  icon: LucideIcon
}

export interface NavGroup {
  label: string
  items: NavItem[]
}

export const NAV: NavGroup[] = [
  {
    label: "Overview",
    items: [{ title: "Dashboard", href: "/", icon: LayoutDashboard }],
  },
  {
    label: "Commerce",
    items: [
      { title: "Products", href: "/products", icon: Boxes },
      { title: "Transactions", href: "/transactions", icon: ArrowLeftRight },
    ],
  },
  {
    label: "Developers",
    items: [
      { title: "Webhooks", href: "/webhooks", icon: Webhook },
      { title: "Apps", href: "/apps", icon: Blocks },
    ],
  },
]

export const SETTINGS_NAV: NavItem = { title: "Settings", href: "/settings", icon: Settings }

/** YaroPay Cloud super admins only: every company on the platform. */
export const PLATFORM_NAV: NavItem = { title: "Platform", href: "/platform", icon: Building2 }

export function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`)
}
