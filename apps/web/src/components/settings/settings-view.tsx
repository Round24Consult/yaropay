"use client"

import type { Permission } from "@yaropay/core/auth"
import { parseAsStringLiteral, useQueryState } from "nuqs"
import { PageHeader } from "@/components/shared/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { BillingPanel } from "@/ee/billing-panel"
import { LicencePanel } from "@/ee/licence-panel"
import { AiAppsPanel } from "@/ee/mcp/ai-apps-panel"
import { useEntitlements, useSettings } from "@/lib/api/hooks"
import { useMe } from "@/lib/auth"
import { hasPermission } from "@yaropay/core/auth"
import { AuditPanel } from "./audit-panel"
import { GeneralForm } from "./general-form"
import { NotificationsPanel } from "./notifications-panel"
import { SecurityPanel } from "./security-panel"
import { TeamPanel } from "./team-panel"

const TABS = ["general", "team", "notifications", "security", "ai-apps", "audit", "billing", "licence"] as const
type Tab = (typeof TABS)[number]

const TAB_META: Record<Tab, { label: string; permission: Permission | null }> = {
  general: { label: "General", permission: "settings:read" },
  team: { label: "Team", permission: "team:read" },
  notifications: { label: "Notifications", permission: null },
  security: { label: "Profile & security", permission: null },
  "ai-apps": { label: "AI apps", permission: null },
  audit: { label: "Audit log", permission: "audit:read" },
  billing: { label: "Billing", permission: "settings:read" },
  licence: { label: "Licence", permission: "settings:read" },
}

export function SettingsView() {
  const me = useMe()
  const { data: entitlements } = useEntitlements()
  // Cloud companies have a bill instead of a licence key; self-hosted installs the other way round.
  const cloud = entitlements?.edition === "cloud"
  const allowed = TABS.filter((t) => {
    if (t === "billing" && !cloud) return false
    if (t === "licence" && (!entitlements || cloud)) return false
    const p = TAB_META[t].permission
    return p === null || hasPermission(me, p)
  })
  const [requested, setTab] = useQueryState("tab", parseAsStringLiteral(TABS).withOptions({ history: "replace" }))
  const tab: Tab = requested && allowed.includes(requested) ? requested : allowed[0]
  const { data: settings } = useSettings({ enabled: allowed.includes("general") })

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="Install-wide settings, your team, and your own account." />
      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
          <TabsList>
            {allowed.map((t) => (
              <TabsTrigger key={t} value={t} data-testid={`settings-tab-${t}`}>
                {TAB_META[t].label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        {allowed.includes("general") && (
          <TabsContent value="general" className="mt-5">
            {settings ? <GeneralForm settings={settings} /> : <Skeleton className="h-96 rounded-2xl" />}
          </TabsContent>
        )}
        {allowed.includes("team") && (
          <TabsContent value="team" className="mt-5">
            <TeamPanel />
          </TabsContent>
        )}
        <TabsContent value="notifications" className="mt-5">
          <NotificationsPanel />
        </TabsContent>
        <TabsContent value="security" className="mt-5">
          <SecurityPanel />
        </TabsContent>
        <TabsContent value="ai-apps" className="mt-5">
          <AiAppsPanel />
        </TabsContent>
        {allowed.includes("audit") && (
          <TabsContent value="audit" className="mt-5">
            <AuditPanel />
          </TabsContent>
        )}
        {allowed.includes("billing") && (
          <TabsContent value="billing" className="mt-5">
            <BillingPanel />
          </TabsContent>
        )}
        {allowed.includes("licence") && (
          <TabsContent value="licence" className="mt-5">
            <LicencePanel />
          </TabsContent>
        )}
      </Tabs>
    </div>
  )
}
