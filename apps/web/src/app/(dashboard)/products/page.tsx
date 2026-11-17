import type { Metadata } from "next"
import { ProductsView } from "@/components/products/products-view"
import { View } from "@/components/shared/view"

export const metadata: Metadata = { title: "Products" }

export default function ProductsPage() {
  return (
    <View>
      <ProductsView />
    </View>
  )
}
