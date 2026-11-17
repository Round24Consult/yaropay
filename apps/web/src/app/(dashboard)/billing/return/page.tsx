import type { Metadata } from "next"
import { Suspense } from "react"
import { PageSkeleton } from "@/components/shared/page-skeleton"
import { View } from "@/components/shared/view"
import { BillingReturn } from "@/ee/billing-panel"

export const metadata: Metadata = { title: "Payment" }

async function Content({ searchParams }: { searchParams: PageProps<"/billing/return">["searchParams"] }) {
  const sp = await searchParams
  const reference = typeof sp.reference === "string" ? sp.reference : typeof sp.trxref === "string" ? sp.trxref : ""
  return (
    <View>
      <BillingReturn reference={reference} />
    </View>
  )
}

export default function BillingReturnPage({ searchParams }: PageProps<"/billing/return">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content searchParams={searchParams} />
    </Suspense>
  )
}
