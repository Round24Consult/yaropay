import type { Metadata } from "next"
import { View } from "@/components/shared/view"
import { OverviewPage } from "@/ee/platform/companies"

export const metadata: Metadata = { title: "Platform" }

export default function PlatformPage() {
  return (
    <View>
      <OverviewPage />
    </View>
  )
}
