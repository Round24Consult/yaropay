import type { Metadata } from "next"
import { View } from "@/components/shared/view"
import { WebhooksView } from "@/components/webhooks/webhooks-view"

export const metadata: Metadata = { title: "Webhooks" }

export default function WebhooksPage() {
  return (
    <View>
      <WebhooksView />
    </View>
  )
}
