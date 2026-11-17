"use client"

import { format } from "date-fns"
import { CalendarDays, Check, ChevronDown, Layers, X } from "lucide-react"
import * as React from "react"
import type { DateRange } from "react-day-picker"
import { GatewayMark } from "@/components/shared/gateway-mark"
import { ProductDot } from "@/components/shared/product-chip"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { PERIOD_PRESETS } from "@yaropay/core/analytics"
import { installableGateways } from "@yaropay/core/gateways/registry"
import { CURRENCIES } from "@yaropay/core/money"
import type { ColorSlot, CurrencyCode } from "@yaropay/core/types"
import { cn } from "@/lib/utils"

export interface ProductOption {
  id: string
  name: string
  colorSlot: ColorSlot
}

/** Multi-select with search; each option carries its product colour. */
export function ProductMultiSelect({
  options,
  value,
  onChange,
  className,
}: {
  options: ProductOption[]
  value: string[]
  onChange: (v: string[]) => void
  className?: string
}) {
  const selected = options.filter((o) => value.includes(o.id))
  const label =
    selected.length === 0 ? "All products" : selected.length === 1 ? selected[0].name : `${selected.length} products`
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className={cn("h-8 justify-between gap-2 font-normal", className)} data-testid="product-filter">
          <span className="flex min-w-0 items-center gap-2">
            {selected.length ? (
              <span className="flex -space-x-1">
                {selected.slice(0, 3).map((s) => (
                  <ProductDot key={s.id} slot={s.colorSlot} className="size-2.5 ring-2 ring-background" />
                ))}
              </span>
            ) : (
              <Layers className="size-3.5 text-muted-foreground" />
            )}
            <span className="truncate">{label}</span>
          </span>
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command>
          <CommandInput placeholder="Filter products…" />
          <CommandList>
            <CommandEmpty>No product found.</CommandEmpty>
            <CommandGroup>
              {options.map((o) => {
                const on = value.includes(o.id)
                return (
                  <CommandItem
                    key={o.id}
                    value={o.name}
                    onSelect={() => onChange(on ? value.filter((v) => v !== o.id) : [...value, o.id])}
                  >
                    <span
                      className={cn(
                        "grid size-4 place-items-center rounded border",
                        on ? "border-primary bg-primary text-primary-foreground" : "border-input",
                      )}
                    >
                      {on && <Check className="size-3" />}
                    </span>
                    <ProductDot slot={o.colorSlot} />
                    {o.name}
                  </CommandItem>
                )
              })}
            </CommandGroup>
            {value.length > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem onSelect={() => onChange([])} className="justify-center text-muted-foreground">
                    Show all products
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

export function PeriodControl({
  period,
  from,
  to,
  onChange,
}: {
  period: string
  from: string | null
  to: string | null
  onChange: (v: { period: string; from?: string | null; to?: string | null }) => void
}) {
  const [initialMonth] = React.useState(() => new Date(Date.now() - 30 * 86_400_000))
  const [range, setRange] = React.useState<DateRange | undefined>(
    from && to ? { from: new Date(from), to: new Date(to) } : undefined,
  )
  return (
    <div className="flex items-center gap-1.5">
      <div role="radiogroup" aria-label="Period" className="flex h-8 items-center rounded-lg border bg-background p-0.5">
        {PERIOD_PRESETS.map((p) => (
          <button
            key={p.value}
            type="button"
            role="radio"
            aria-checked={period === p.value}
            title={p.label}
            onClick={() => onChange({ period: p.value, from: null, to: null })}
            className={cn(
              "h-full rounded-md px-2 text-xs font-medium transition-colors",
              period === p.value ? "bg-secondary text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {p.short}
          </button>
        ))}
      </div>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className={cn("h-8 gap-2 font-normal", period === "custom" && "border-primary/50 bg-accent/50")}
            aria-label="Custom date range"
          >
            <CalendarDays className="size-3.5 text-muted-foreground" />
            {period === "custom" && from && to ? (
              <span className="text-xs">
                {format(new Date(from), "d MMM")} – {format(new Date(to), "d MMM yyyy")}
              </span>
            ) : (
              <span className="hidden text-xs xl:inline">Custom</span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="end">
          <Calendar
            mode="range"
            numberOfMonths={2}
            selected={range}
            onSelect={setRange}
            disabled={{ after: new Date() }}
            defaultMonth={range?.from ?? initialMonth}
          />
          <div className="flex items-center justify-end gap-2 border-t p-3">
            <Button variant="ghost" size="sm" onClick={() => setRange(undefined)}>
              Clear
            </Button>
            <Button
              size="sm"
              disabled={!range?.from || !range?.to}
              onClick={() =>
                range?.from &&
                range?.to &&
                onChange({
                  period: "custom",
                  from: format(range.from, "yyyy-MM-dd"),
                  to: format(range.to, "yyyy-MM-dd"),
                })
              }
            >
              Apply
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}

export function GatewaySelect({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const available = installableGateways
  return (
    <Select value={value[0] ?? "all"} onValueChange={(v) => onChange(v === "all" ? [] : [v])}>
      <SelectTrigger size="sm" className="h-8 w-auto min-w-36 gap-2" aria-label="Gateway">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All gateways</SelectItem>
        {available.map((g) => (
          <SelectItem key={g.id} value={g.id}>
            <GatewayMark gatewayId={g.id} size="sm" className="size-4 text-[7px]" />
            {g.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function CurrencySelect({ value, onChange }: { value: CurrencyCode; onChange: (v: CurrencyCode) => void }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as CurrencyCode)}>
      <SelectTrigger size="sm" className="h-8 w-auto gap-2" aria-label="Currency">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {CURRENCIES.map((c) => (
          <SelectItem key={c.code} value={c.code}>
            <span className="font-mono text-xs">{c.code}</span>
            <span className="text-muted-foreground">{c.name}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function ActiveFilterChips({
  products,
  selected,
  onRemove,
  onClear,
}: {
  products: ProductOption[]
  selected: string[]
  onRemove: (id: string) => void
  onClear: () => void
}) {
  if (!selected.length) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-muted-foreground">Showing</span>
      {selected.map((id) => {
        const p = products.find((x) => x.id === id)
        if (!p) return null
        return (
          <span key={id} className="inline-flex h-6 items-center gap-1.5 rounded-full border bg-card pr-1 pl-2 text-xs font-medium">
            <ProductDot slot={p.colorSlot} />
            {p.name}
            <button type="button" onClick={() => onRemove(id)} className="grid size-4 place-items-center rounded-full hover:bg-muted" aria-label={`Remove ${p.name}`}>
              <X className="size-3" />
            </button>
          </span>
        )
      })}
      <button type="button" className="text-xs text-muted-foreground underline-offset-2 hover:underline" onClick={onClear}>
        Clear
      </button>
    </div>
  )
}
