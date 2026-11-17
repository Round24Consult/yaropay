import type { Metadata } from "next"
import { SettingsView } from "@/components/settings/settings-view"
import { View } from "@/components/shared/view"

export const metadata: Metadata = { title: "Settings" }

export default function SettingsPage() {
  return (
    <View>
      <SettingsView />
    </View>
  )
}
