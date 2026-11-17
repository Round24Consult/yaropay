"use client"

import { usePathname } from "next/navigation"
import type * as React from "react"
import { PlatformSidebar } from "@/ee/platform/platform-sidebar"
import { useMe } from "@/lib/auth"
import { AppSidebar } from "./app-sidebar"

/** The platform console (YaroPay Cloud super admins) lives under /platform. */
export const isConsolePath = (pathname: string) => pathname === "/platform" || pathname.startsWith("/platform/")

/** The company sidebar, or the console's own menu on /platform pages for super admins. */
export function DashboardSidebar() {
  const pathname = usePathname()
  const me = useMe()
  if (isConsolePath(pathname) && me.platformRole === "super_admin") return <PlatformSidebar />
  return <AppSidebar />
}

/** Hides company-only banners (billing, sample data) inside the platform console. */
export function CompanyOnly({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  return isConsolePath(pathname) ? null : children
}
