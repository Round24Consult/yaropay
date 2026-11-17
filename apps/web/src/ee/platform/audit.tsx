"use client"

// YaroPay Enterprise License: see LICENSE.md in the parent folder.

import Link from "next/link"
import { Panel, PanelHeader } from "@/components/shared/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatDateTime, formatRelative } from "@/lib/format"
import { usePlatformAudit } from "./hooks"
import { PlatformShell } from "./platform-shell"

export function PlatformAuditPage() {
  const { data, isLoading } = usePlatformAudit()
  return (
    <PlatformShell title="Platform audit log" description="Everything done from this console, newest first. Entries can't be changed or removed.">
      <Panel className="overflow-hidden">
        <PanelHeader title="Actions" />
        <div className="mt-3 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">Who</TableHead>
                <TableHead>What</TableHead>
                <TableHead className="hidden md:table-cell">IP address</TableHead>
                <TableHead className="pr-5 text-right">When</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading &&
                Array.from({ length: 4 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={4} className="px-5">
                      <Skeleton className="h-6" />
                    </TableCell>
                  </TableRow>
                ))}
              {data?.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="pl-5 font-medium whitespace-nowrap">{a.actorEmail}</TableCell>
                  <TableCell className="min-w-56 text-sm">
                    {a.action}
                    {typeof a.detail.name === "string" && (
                      <>
                        {": "}
                        {a.workspaceId ? (
                          <Link href={`/platform/workspaces/${a.workspaceId}`} className="font-medium hover:underline">
                            {a.detail.name}
                          </Link>
                        ) : (
                          <span className="font-medium">{a.detail.name}</span>
                        )}
                      </>
                    )}
                    {typeof a.detail.slug === "string" && <span className="font-mono text-xs text-muted-foreground"> ({a.detail.slug})</span>}
                    {typeof a.detail.reason === "string" && <span className="text-muted-foreground">. Reason: {a.detail.reason}</span>}
                  </TableCell>
                  <TableCell className="hidden font-mono text-xs text-muted-foreground md:table-cell">{a.ip ?? "–"}</TableCell>
                  <TableCell className="pr-5 text-right text-xs whitespace-nowrap text-muted-foreground" title={formatDateTime(a.at)}>
                    {formatRelative(a.at)}
                  </TableCell>
                </TableRow>
              ))}
              {data && data.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-10 text-center text-sm text-muted-foreground">
                    Nothing done from the console yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </Panel>
    </PlatformShell>
  )
}
