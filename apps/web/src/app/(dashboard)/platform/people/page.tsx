import type { Metadata } from "next"
import { View } from "@/components/shared/view"
import { PeoplePage } from "@/ee/platform/people"

export const metadata: Metadata = { title: "People" }

export default function PlatformPeoplePage() {
  return (
    <View>
      <PeoplePage />
    </View>
  )
}
