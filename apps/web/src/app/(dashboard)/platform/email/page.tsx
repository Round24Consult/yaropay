import type { Metadata } from "next"
import { View } from "@/components/shared/view"
import { PlatformEmailPage } from "@/ee/platform/settings"

export const metadata: Metadata = { title: "Email" }

export default function PlatformEmailRoute() {
  return (
    <View>
      <PlatformEmailPage />
    </View>
  )
}
