import type { Metadata } from "next"
import { View } from "@/components/shared/view"
import { TransactionsView } from "@/components/transactions/transactions-view"

export const metadata: Metadata = { title: "Transactions" }

export default function TransactionsPage() {
  return (
    <View>
      <TransactionsView />
    </View>
  )
}
