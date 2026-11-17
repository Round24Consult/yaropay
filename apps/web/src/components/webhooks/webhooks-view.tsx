"use client"

import { ArrowDownToLine, ArrowUpFromLine } from "lucide-react"
import { parseAsString, parseAsStringLiteral, useQueryStates } from "nuqs"
import { PageHeader } from "@/components/shared/page-header"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { DeliveriesTable, EventsTable } from "./tables"

export function WebhooksView() {
  const [q, setQ] = useQueryStates(
    {
      tab: parseAsStringLiteral(["outgoing", "incoming"] as const).withDefault("outgoing"),
      state: parseAsString.withDefault(""),
      routing: parseAsString.withDefault(""),
    },
    { history: "replace" },
  )
  return (
    <div className="space-y-6">
      <PageHeader
        title="Webhooks"
        description="Gateways send every event to one YaroPay URL per account. YaroPay checks the signature, finds the product that owns the payment and forwards a signed event to that product only."
      />
      <Tabs value={q.tab} onValueChange={(v) => setQ({ tab: v as "outgoing" | "incoming" })}>
        <TabsList>
          <TabsTrigger value="outgoing">
            <ArrowUpFromLine /> To your products
          </TabsTrigger>
          <TabsTrigger value="incoming">
            <ArrowDownToLine /> From gateways
          </TabsTrigger>
        </TabsList>
        <TabsContent value="outgoing" className="mt-4">
          <DeliveriesTable state={q.state} onState={(s) => setQ({ state: s || null })} />
        </TabsContent>
        <TabsContent value="incoming" className="mt-4">
          <EventsTable routing={q.routing} onRouting={(r) => setQ({ routing: r || null })} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
