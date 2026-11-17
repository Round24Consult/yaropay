import { Suspense } from "react"
import { ProductDetail } from "@/components/products/product-detail"
import { PageSkeleton } from "@/components/shared/page-skeleton"
import { View } from "@/components/shared/view"

async function Content({ params }: { params: PageProps<"/products/[productId]">["params"] }) {
  const { productId } = await params
  return (
    <View>
      <ProductDetail id={productId} />
    </View>
  )
}

export default function ProductPage({ params }: PageProps<"/products/[productId]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content params={params} />
    </Suspense>
  )
}
