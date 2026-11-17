import { BrandMark } from "@/components/shared/brand-mark"
import { PageSkeleton } from "@/components/shared/page-skeleton"
import { Sidebar, SidebarContent, SidebarHeader, SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { Skeleton } from "@/components/ui/skeleton"

/** Shown for the instant before the sidebar reads the current URL. */
export function SidebarFallback() {
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="p-3">
        <div className="flex h-12 items-center gap-2 px-2">
          <BrandMark />
        </div>
      </SidebarHeader>
      <SidebarContent className="gap-2 px-3 pt-2">
        {[70, 55, 62, 48, 66, 52].map((w, i) => (
          <div key={i} className="flex h-8 items-center gap-2 px-2">
            <Skeleton className="size-4 rounded-md" />
            <Skeleton className="h-3.5" style={{ width: `${w}%` }} />
          </div>
        ))}
      </SidebarContent>
    </Sidebar>
  )
}

export function TopbarFallback() {
  return <div className="h-14 shrink-0 border-b bg-background/80" />
}

/** The whole dashboard frame, rendered on the server and while the session is checked. */
export function ShellFallback() {
  return (
    <SidebarProvider>
      <SidebarFallback />
      <SidebarInset className="min-w-0">
        <TopbarFallback />
        <div className="mx-auto w-full max-w-[1400px] min-w-0 flex-1 px-4 py-6 md:px-6 md:py-8">
          <PageSkeleton />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
