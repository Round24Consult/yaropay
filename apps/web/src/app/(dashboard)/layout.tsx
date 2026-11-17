import { Suspense } from "react"
import { ShellFallback } from "@/components/layout/shell-fallbacks"
import { CompanyOnly, DashboardSidebar } from "@/components/layout/sidebar-switch"
import { SupportBanner } from "@/components/layout/support-banner"
import { Topbar } from "@/components/layout/topbar"
import { SampleDataBanner } from "@/components/onboarding/sample-data"
import { BillingBanner } from "@/ee/billing-panel"
import { ClientGate } from "@/components/shared/client-gate"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { AuthGate } from "@/lib/auth"

export default function DashboardLayout({ children }: LayoutProps<"/">) {
  return (
    <Suspense fallback={<ShellFallback />}>
      <ClientGate fallback={<ShellFallback />}>
        <AuthGate fallback={<ShellFallback />}>
          <SidebarProvider>
            <DashboardSidebar />
            <SidebarInset className="min-w-0">
              <Topbar />
              <SupportBanner />
              <CompanyOnly>
                <BillingBanner />
                <SampleDataBanner />
              </CompanyOnly>
              <div id="content" className="mx-auto w-full max-w-[1400px] min-w-0 flex-1 px-4 py-6 md:px-6 md:py-8">
                {children}
              </div>
            </SidebarInset>
          </SidebarProvider>
        </AuthGate>
      </ClientGate>
    </Suspense>
  )
}
