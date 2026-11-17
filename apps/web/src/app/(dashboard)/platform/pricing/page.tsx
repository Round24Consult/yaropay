import type { Metadata } from "next"
import { View } from "@/components/shared/view"
import { PricingPage } from "@/ee/platform/pricing"

export const metadata: Metadata = { title: "Plans & pricing" }

export default function PlatformPricingPage() {
  return (
    <View>
      <PricingPage />
    </View>
  )
}
