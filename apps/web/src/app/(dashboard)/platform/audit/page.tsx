import type { Metadata } from "next"
import { View } from "@/components/shared/view"
import { PlatformAuditPage } from "@/ee/platform/audit"

export const metadata: Metadata = { title: "Platform audit log" }

export default function PlatformAuditRoute() {
  return (
    <View>
      <PlatformAuditPage />
    </View>
  )
}
