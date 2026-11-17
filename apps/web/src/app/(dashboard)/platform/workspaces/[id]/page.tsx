import type { Metadata } from "next"
import { Suspense } from "react"
import { PageSkeleton } from "@/components/shared/page-skeleton"
import { View } from "@/components/shared/view"
import { WorkspaceDetailPage } from "@/ee/platform/workspace-detail"

export const metadata: Metadata = { title: "Company" }

async function Content({ params }: { params: PageProps<"/platform/workspaces/[id]">["params"] }) {
  const { id } = await params
  return (
    <View>
      <WorkspaceDetailPage id={id} />
    </View>
  )
}

export default function PlatformWorkspacePage({ params }: PageProps<"/platform/workspaces/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content params={params} />
    </Suspense>
  )
}
