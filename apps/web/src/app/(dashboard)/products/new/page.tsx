import type { Metadata } from "next"
import { ProductWizard } from "@/components/products/product-wizard"
import { View } from "@/components/shared/view"

export const metadata: Metadata = { title: "New product" }

export default function NewProductPage() {
  return (
    <View>
      <ProductWizard />
    </View>
  )
}
