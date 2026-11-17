import type { Metadata } from "next"
import { View } from "@/components/shared/view"
import { CompaniesPage } from "@/ee/platform/companies"

export const metadata: Metadata = { title: "Companies" }

export default function PlatformCompaniesPage() {
  return (
    <View>
      <CompaniesPage />
    </View>
  )
}
