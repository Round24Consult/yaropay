import type { Metadata } from "next"
import { View } from "@/components/shared/view"
import { PlatformBillingPage } from "@/ee/platform/settings"

export const metadata: Metadata = { title: "Billing" }

export default function PlatformBillingRoute() {
  return (
    <View>
      <PlatformBillingPage />
    </View>
  )
}
