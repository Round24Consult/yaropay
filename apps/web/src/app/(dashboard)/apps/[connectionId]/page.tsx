import { Suspense } from "react"
import { ConnectionView } from "@/components/apps/connection-view"
import { PageSkeleton } from "@/components/shared/page-skeleton"
import { View } from "@/components/shared/view"

async function Content({ params }: { params: PageProps<"/apps/[connectionId]">["params"] }) {
  const { connectionId } = await params
  return (
    <View>
      <ConnectionView id={connectionId} />
    </View>
  )
}

export default function ConnectionPage({ params }: PageProps<"/apps/[connectionId]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content params={params} />
    </Suspense>
  )
}
