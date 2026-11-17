import type { Metadata } from "next"
import { View } from "@/components/shared/view"
import { PlatformSettingsPage } from "@/ee/platform/settings"

export const metadata: Metadata = { title: "Platform settings" }

export default function PlatformSettingsRoute() {
  return (
    <View>
      <PlatformSettingsPage />
    </View>
  )
}
