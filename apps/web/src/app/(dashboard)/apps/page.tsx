import type { Metadata } from "next"
import { AppsView } from "@/components/apps/apps-view"
import { View } from "@/components/shared/view"

export const metadata: Metadata = { title: "Apps" }

export default function AppsPage() {
  return (
    <View>
      <AppsView />
    </View>
  )
}
