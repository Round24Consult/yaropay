import type { Metadata } from "next"
import { View } from "@/components/shared/view"
import { PlatformGatewaysPage } from "@/ee/platform/gateways"

export const metadata: Metadata = { title: "Gateways" }

export default function PlatformGatewaysRoute() {
  return (
    <View>
      <PlatformGatewaysPage />
    </View>
  )
}
