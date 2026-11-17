"use client"

import { Check, ChevronDown } from "lucide-react"
import * as React from "react"
import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import type { ColorSlot } from "@yaropay/core/types"
import { cn } from "@/lib/utils"
import { ProductDot } from "./product-chip"

interface ProductOption {
  id: string
  name: string
  colorSlot: ColorSlot
}

/**
 * Picks which products a member can see. `null` means every product,
 * including ones created later.
 */
export function ProductScopeSelect({
  value,
  onChange,
  products,
  disabled,
  className,
  id,
}: {
  value: string[] | null
  onChange: (value: string[] | null) => void
  products: ProductOption[]
  disabled?: boolean
  className?: string
  id?: string
}) {
  const [open, setOpen] = React.useState(false)
  const selected = value ?? []
  const chosen = products.filter((p) => selected.includes(p.id))
  const toggle = (pid: string) => {
    const next = selected.includes(pid) ? selected.filter((x) => x !== pid) : [...selected, pid]
    onChange(next)
  }
  const label =
    value === null
      ? "All products"
      : chosen.length === 0
        ? "No products"
        : chosen.length === 1
          ? chosen[0].name
          : `${chosen.length} products`
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          className={cn("h-8 justify-between gap-2 font-normal", className)}
          aria-label={`Product access: ${label}`}
        >
          <span className="flex min-w-0 items-center gap-1.5">
            {value !== null && chosen.length > 0 && (
              <span className="flex -space-x-0.5">
                {chosen.slice(0, 3).map((p) => (
                  <ProductDot key={p.id} slot={p.colorSlot} className="ring-2 ring-background" />
                ))}
              </span>
            )}
            <span className={cn("truncate", value !== null && chosen.length === 0 && "text-critical-text")}>{label}</span>
          </span>
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <Command>
          <CommandInput placeholder="Find a product…" />
          <CommandList>
            <CommandEmpty>No products.</CommandEmpty>
            <CommandGroup>
              <CommandItem value="__all" onSelect={() => onChange(value === null ? [] : null)}>
                <span className={cn("grid size-4 place-items-center rounded-sm border", value === null && "border-primary bg-primary text-primary-foreground")}>
                  {value === null && <Check className="size-3" />}
                </span>
                <span className="flex-1">All products</span>
                <span className="text-[11px] text-muted-foreground">incl. future</span>
              </CommandItem>
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup heading="Only these">
              {products.map((p) => {
                const on = value !== null && selected.includes(p.id)
                return (
                  <CommandItem key={p.id} value={`${p.name} ${p.id}`} onSelect={() => toggle(p.id)}>
                    <span className={cn("grid size-4 place-items-center rounded-sm border", on && "border-primary bg-primary text-primary-foreground")}>
                      {on && <Check className="size-3" />}
                    </span>
                    <ProductDot slot={p.colorSlot} />
                    <span className="truncate">{p.name}</span>
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
