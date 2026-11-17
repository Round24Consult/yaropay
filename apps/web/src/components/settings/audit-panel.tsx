"use client"

import { Panel, PanelHeader } from "@/components/shared/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useAudit } from "@/lib/api/hooks"
import { formatDateTime, formatRelative } from "@/lib/format"

export function AuditPanel() {
  const { data, isLoading } = useAudit()
  return (
    <Panel className="overflow-hidden">
      <PanelHeader title="Audit log" description="Sign-ins, team changes, and changes to products, gateways, keys and settings." />
      <div className="mt-3 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-5">Who</TableHead>
              <TableHead>What</TableHead>
              <TableHead className="hidden sm:table-cell">IP address</TableHead>
              <TableHead className="pr-5 text-right">When</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading &&
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={4} className="px-5">
                    <Skeleton className="h-6" />
                  </TableCell>
                </TableRow>
              ))}
            {data?.map((a) => (
              <TableRow key={a.id}>
                <TableCell className="pl-5 font-medium whitespace-nowrap">{a.actor}</TableCell>
                <TableCell className="min-w-48">
                  <span className="text-muted-foreground">{a.action}</span> {a.target}
                </TableCell>
                <TableCell className="hidden font-mono text-xs text-muted-foreground sm:table-cell">{a.ip ?? "–"}</TableCell>
                <TableCell className="pr-5 text-right text-xs whitespace-nowrap text-muted-foreground" title={formatDateTime(a.at)}>
                  {formatRelative(a.at)}
                </TableCell>
              </TableRow>
            ))}
            {data && data.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="py-10 text-center text-sm text-muted-foreground">
                  Nothing recorded yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </Panel>
  )
}
