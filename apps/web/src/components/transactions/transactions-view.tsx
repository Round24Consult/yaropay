"use client"

import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table"
import { ArrowDown, ArrowUp, ArrowUpDown, Check, Download, PlusCircle, Search, X } from "lucide-react"
import { useQueryStates } from "nuqs"
import * as React from "react"
import { PeriodControl } from "@/components/dashboard/filter-bar"
import { GatewayMark, gatewayName } from "@/components/shared/gateway-mark"
import { PageHeader, Panel } from "@/components/shared/page-header"
import { ProductChip, ProductDot } from "@/components/shared/product-chip"
import { TransactionStatusBadge } from "@/components/shared/status-badge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { TransactionRow } from "@yaropay/core/api"
import { gatewayRegistry } from "@yaropay/core/gateways/registry"
import { CURRENCIES, formatMoney } from "@yaropay/core/money"
import type { ColorSlot } from "@yaropay/core/types"
import { API_BASE, toQuery } from "@/lib/api/client"
import { useCan } from "@/lib/auth"
import { useProducts, useTransactions } from "@/lib/api/hooks"
import { transactionFilters } from "@/lib/filters"
import { CHANNEL_LABELS, channelLabel, formatDateTime, STATUS_LABELS } from "@/lib/format"
import { useMode } from "@/lib/mode"
import { cn } from "@/lib/utils"
import { Pager } from "../webhooks/tables"
import { TransactionSheet } from "./transaction-sheet"

const PAGE_SIZE = 20

interface FacetOption {
  value: string
  label: string
  icon?: React.ReactNode
}

function FacetFilter({
  title,
  options,
  value,
  counts,
  onChange,
  testId,
}: {
  title: string
  options: FacetOption[]
  value: string[]
  counts?: Record<string, number>
  onChange: (v: string[]) => void
  testId?: string
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className="h-8 gap-1.5 border-dashed font-normal" data-testid={testId}>
          <PlusCircle className="size-3.5 text-muted-foreground" />
          {title}
          {value.length > 0 && (
            <>
              <span className="mx-0.5 h-4 w-px bg-border" />
              {value.length > 2 ? (
                <Badge variant="secondary" className="rounded-sm px-1 font-normal">
                  {value.length} selected
                </Badge>
              ) : (
                options
                  .filter((o) => value.includes(o.value))
                  .map((o) => (
                    <Badge key={o.value} variant="secondary" className="gap-1 rounded-sm px-1 font-normal">
                      {o.icon}
                      {o.label}
                    </Badge>
                  ))
              )}
            </>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-60 p-0" align="start">
        <Command>
          <CommandInput placeholder={title} />
          <CommandList>
            <CommandEmpty>No results.</CommandEmpty>
            <CommandGroup>
              {options.map((o) => {
                const on = value.includes(o.value)
                return (
                  <CommandItem key={o.value} value={o.label} onSelect={() => onChange(on ? value.filter((v) => v !== o.value) : [...value, o.value])}>
                    <span className={cn("grid size-4 place-items-center rounded border", on ? "border-primary bg-primary text-primary-foreground" : "border-input")}>
                      {on && <Check className="size-3" />}
                    </span>
                    {o.icon}
                    <span>{o.label}</span>
                    <span className="ml-auto font-mono text-xs text-muted-foreground">{counts?.[o.value] ?? 0}</span>
                  </CommandItem>
                )
              })}
            </CommandGroup>
            {value.length > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem onSelect={() => onChange([])} className="justify-center text-muted-foreground">
                    Clear filter
                  </CommandItem>
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function SortHeader({ label, field, sort, onSort, className }: { label: string; field: string; sort: string; onSort: (s: string) => void; className?: string }) {
  const active = sort.replace(/^-/, "") === field
  const desc = sort.startsWith("-")
  const Icon = !active ? ArrowUpDown : desc ? ArrowDown : ArrowUp
  return (
    <button
      type="button"
      onClick={() => onSort(active && desc ? field : `-${field}`)}
      className={cn("-ml-1 inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-muted", className)}
      aria-label={`Sort by ${label}`}
    >
      {label}
      <Icon className={cn("size-3", !active && "text-muted-foreground/60")} />
    </button>
  )
}

export function TransactionsView() {
  const [f, setF] = useQueryStates(transactionFilters, { history: "replace" })
  const { mode } = useMode()
  const { data: products = [] } = useProducts()
  const canExport = useCan("transactions:export")
  const [search, setSearch] = React.useState(f.q)

  // Debounce typing into the URL.
  React.useEffect(() => {
    const t = setTimeout(() => {
      if (search !== f.q) setF({ q: search || null, page: 1 })
    }, 250)
    return () => clearTimeout(t)
  }, [search, f.q, setF])

  const params = {
    mode,
    q: f.q || undefined,
    period: f.period,
    from: f.period === "custom" ? f.from : undefined,
    to: f.period === "custom" ? f.to : undefined,
    product: f.product,
    gateway: f.gateway,
    status: f.status,
    channel: f.channel,
    currency: f.currency ?? undefined,
    sort: f.sort,
    page: f.page,
    pageSize: PAGE_SIZE,
  }
  const { data, isLoading, isFetching } = useTransactions(params)
  const productMap = React.useMemo(() => new Map(products.map((p) => [p.id, p])), [products])

  const columns = React.useMemo<ColumnDef<TransactionRow>[]>(
    () => [
      {
        id: "amount",
        header: () => <SortHeader label="Amount" field="amount" sort={f.sort} onSort={(s) => setF({ sort: s, page: 1 })} />,
        cell: ({ row }) => (
          <div>
            <p className="font-medium tabular">{formatMoney(row.original.amount, row.original.currency)}</p>
            <p className="font-mono text-[11px] text-muted-foreground">{row.original.currency}</p>
          </div>
        ),
      },
      {
        id: "status",
        header: "Status",
        cell: ({ row }) => <TransactionStatusBadge status={row.original.status} />,
      },
      {
        id: "product",
        header: "Product",
        cell: ({ row }) => {
          const p = productMap.get(row.original.productId)
          return p ? <ProductChip name={p.name} slot={p.colorSlot} size="sm" /> : <span className="text-xs text-muted-foreground">Deleted</span>
        },
      },
      {
        id: "reference",
        header: "Reference",
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="font-mono text-xs">{row.original.reference}</p>
            <p className="max-w-52 truncate text-xs text-muted-foreground">{row.original.customer.email}</p>
          </div>
        ),
      },
      {
        id: "gateway",
        header: "Gateway",
        meta: { className: "hidden lg:table-cell" },
        cell: ({ row }) => (
          <span className="flex items-center gap-2 text-sm">
            <GatewayMark gatewayId={row.original.gatewayId} size="sm" />
            <span className="hidden xl:inline">{gatewayName(row.original.gatewayId)}</span>
          </span>
        ),
      },
      {
        id: "channel",
        header: "Channel",
        meta: { className: "hidden md:table-cell" },
        cell: ({ row }) => <span className="text-sm text-muted-foreground">{channelLabel(row.original.channel)}</span>,
      },
      {
        id: "createdAt",
        header: () => <SortHeader label="Date" field="createdAt" sort={f.sort} onSort={(s) => setF({ sort: s, page: 1 })} />,
        cell: ({ row }) => <span className="text-xs whitespace-nowrap text-muted-foreground">{formatDateTime(row.original.createdAt)}</span>,
      },
    ],
    [f.sort, setF, productMap],
  )

  const sorting: SortingState = [{ id: f.sort.replace(/^-/, ""), desc: f.sort.startsWith("-") }]
  const table = useReactTable({
    data: data?.rows ?? [],
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
    state: { sorting },
    getRowId: (r) => r.id,
  })

  const productOptions: FacetOption[] = products.map((p) => ({
    value: p.id,
    label: p.name,
    icon: <ProductDot slot={p.colorSlot as ColorSlot} />,
  }))
  const gatewayOptions: FacetOption[] = gatewayRegistry
    .filter((g) => g.status === "available")
    .map((g) => ({ value: g.id, label: g.name, icon: <GatewayMark gatewayId={g.id} size="sm" className="size-4 text-[7px]" /> }))
  const statusOptions: FacetOption[] = Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }))
  const channelOptions: FacetOption[] = Object.entries(CHANNEL_LABELS).map(([value, label]) => ({ value, label }))

  const filtered = f.q || f.product.length || f.gateway.length || f.status.length || f.channel.length || f.currency
  const reset = () => {
    setSearch("")
    setF({ q: null, product: null, gateway: null, status: null, channel: null, currency: null, page: 1 })
  }

  // Server-side export with the same filters (every matching row, not just this page).
  const { page: _page, pageSize: _pageSize, ...exportParams } = params
  void _page
  void _pageSize
  const exportHref = `${API_BASE}/transactions/export.csv${toQuery(exportParams)}`

  return (
    <div className="space-y-6">
      <PageHeader
        title="Transactions"
        description="Every payment across your products. Each row belongs to exactly one product, even when they share a gateway account."
        actions={
          canExport ? (
            <Button variant="outline" asChild>
              <a href={exportHref} download data-testid="export-csv">
                <Download /> Export CSV
              </a>
            </Button>
          ) : null
        }
      />

      <Panel className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b p-3 xl:flex-row xl:items-center">
          <InputGroup className="h-8 xl:w-72">
            <InputGroupAddon>
              <Search />
            </InputGroupAddon>
            <InputGroupInput
              placeholder="Reference, email or name"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search transactions"
            />
          </InputGroup>
          <div className="flex flex-wrap items-center gap-2">
            <FacetFilter
              title="Product"
              options={productOptions}
              value={f.product}
              counts={data?.facets.products}
              onChange={(v) => setF({ product: v.length ? v : null, page: 1 })}
              testId="facet-product"
            />
            <FacetFilter title="Status" options={statusOptions} value={f.status} counts={data?.facets.statuses} onChange={(v) => setF({ status: v.length ? v : null, page: 1 })} />
            <FacetFilter title="Gateway" options={gatewayOptions} value={f.gateway} counts={data?.facets.gateways} onChange={(v) => setF({ gateway: v.length ? v : null, page: 1 })} />
            <FacetFilter title="Channel" options={channelOptions} value={f.channel} counts={data?.facets.channels} onChange={(v) => setF({ channel: v.length ? v : null, page: 1 })} />
            <Select value={f.currency ?? "all"} onValueChange={(v) => setF({ currency: v === "all" ? null : v, page: 1 })}>
              <SelectTrigger size="sm" className="h-8 w-auto gap-2 border-dashed" aria-label="Currency">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All currencies</SelectItem>
                {CURRENCIES.map((c) => (
                  <SelectItem key={c.code} value={c.code}>
                    {c.code}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {filtered ? (
              <Button variant="ghost" size="sm" onClick={reset} className="h-8">
                Reset <X />
              </Button>
            ) : null}
          </div>
          <div className="xl:ml-auto">
            <PeriodControl
              period={f.period === "all" ? "" : f.period}
              from={f.from}
              to={f.to}
              onChange={(v) => setF({ period: v.period as typeof f.period, from: v.from ?? null, to: v.to ?? null, page: 1 })}
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-b bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
          <span data-testid="tx-total" className="tabular">
            {data ? `${data.total.toLocaleString()} payments` : "Loading…"}
            {data?.summary.currency && ` · ${formatMoney(data.summary.volume, data.summary.currency)} succeeded`}
          </span>
          <span className="flex items-center gap-2">
            {isFetching && <span className="size-1.5 animate-pulse rounded-full bg-primary" aria-label="Updating" />}
            {f.period === "all" ? (
              "All time"
            ) : (
              <button type="button" className="underline-offset-2 hover:underline" onClick={() => setF({ period: "all", page: 1 })}>
                Show all time
              </button>
            )}
          </span>
        </div>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((hg) => (
                <TableRow key={hg.id}>
                  {hg.headers.map((h, i) => (
                    <TableHead
                      key={h.id}
                      className={cn(i === 0 && "pl-4", (h.column.columnDef.meta as { className?: string } | undefined)?.className)}
                    >
                      {flexRender(h.column.columnDef.header, h.getContext())}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody className={cn(isFetching && !isLoading && "opacity-70 transition-opacity")}>
              {isLoading &&
                Array.from({ length: 10 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={columns.length} className="pl-4">
                      <Skeleton className="h-8" />
                    </TableCell>
                  </TableRow>
                ))}
              {table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  className="cursor-pointer"
                  onClick={() => setF({ tx: row.original.id })}
                  data-testid="tx-row"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === "Enter" && setF({ tx: row.original.id })}
                >
                  {row.getVisibleCells().map((cell, i) => (
                    <TableCell
                      key={cell.id}
                      className={cn("py-2.5", i === 0 && "pl-4", (cell.column.columnDef.meta as { className?: string } | undefined)?.className)}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
              {data && data.rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={columns.length} className="py-16 text-center">
                    <p className="font-medium">No payments match these filters</p>
                    <Button variant="link" onClick={reset}>
                      Clear filters
                    </Button>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        {data && <Pager page={data.page} pages={data.pages} total={data.total} onPage={(p) => setF({ page: p })} />}
      </Panel>

      <TransactionSheet id={f.tx} onClose={() => setF({ tx: null })} />
    </div>
  )
}
