import type { Metadata } from "next"
import { View } from "@/components/shared/view"
import { CompaniesPage } from "@/ee/platform/companies"

export const metadata: Metadata = { title: "Platform" }

export default function PlatformPage() {
  return (
    <View>
      <CompaniesPage />
    </View>
  )
}
