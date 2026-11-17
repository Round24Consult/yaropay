import type { Metadata } from "next"
import { View } from "@/components/shared/view"
import { InvoicesPage } from "@/ee/platform/invoices"

export const metadata: Metadata = { title: "Invoices" }

export default function PlatformInvoicesRoute() {
  return (
    <View>
      <InvoicesPage />
    </View>
  )
}
