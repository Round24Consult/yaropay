"use client"

import { ArrowRight, Moon, Plus, Receipt, Sun } from "lucide-react"
import { useRouter } from "next/navigation"
import * as React from "react"
import { useTheme } from "@/components/theme/theme-provider"
import { ProductDot } from "@/components/shared/product-chip"
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command"
import { useProducts } from "@/lib/api/hooks"
import { useCan, useHasAllProducts } from "@/lib/auth"
import { NAV, SETTINGS_NAV } from "./nav"

export function CommandMenu({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter()
  const { data: products } = useProducts()
  const { resolvedTheme, setTheme } = useTheme()
  const canWriteProducts = useCan("products:write")
  const allProducts = useHasAllProducts()
  const canInstall = useCan("gateways:write")
  const [query, setQuery] = React.useState("")

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        onOpenChange(!open)
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [open, onOpenChange])

  const go = (href: string) => {
    onOpenChange(false)
    setQuery("")
    router.push(href)
  }

  const looksLikeReference = /^[A-Za-z]{2,6}_[0-9A-Za-z]{4,}$|^T\d{6,}$/.test(query.trim())

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Search" description="Jump to a page, product or payment reference">
      <CommandInput placeholder="Search pages, products, or paste a reference…" value={query} onValueChange={setQuery} />
      <CommandList>
        <CommandEmpty>
          {query ? (
            <button type="button" className="mx-auto flex items-center gap-2 text-sm" onClick={() => go(`/transactions?q=${encodeURIComponent(query)}&period=all`)}>
              Search transactions for <span className="font-mono">{query}</span> <ArrowRight className="size-3.5" />
            </button>
          ) : (
            "No results."
          )}
        </CommandEmpty>
        {looksLikeReference && (
          <CommandGroup heading="Payment">
            <CommandItem value={`ref ${query}`} onSelect={() => go(`/transactions?q=${encodeURIComponent(query.trim())}&period=all`)}>
              <Receipt />
              Find payment <span className="font-mono">{query.trim()}</span>
            </CommandItem>
          </CommandGroup>
        )}
        <CommandGroup heading="Pages">
          {[...NAV.flatMap((g) => g.items), SETTINGS_NAV].map((item) => (
            <CommandItem key={item.href} value={`page ${item.title}`} onSelect={() => go(item.href)}>
              <item.icon />
              {item.title}
            </CommandItem>
          ))}
        </CommandGroup>
        {products && products.length > 0 && (
          <CommandGroup heading="Products">
            {products.map((p) => (
              <CommandItem key={p.id} value={`product ${p.name} ${p.referencePrefix}`} onSelect={() => go(`/products/${p.id}`)}>
                <ProductDot slot={p.colorSlot} />
                {p.name}
                <span className="ml-auto font-mono text-xs text-muted-foreground">{p.referencePrefix}_</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        <CommandSeparator />
        <CommandGroup heading="Actions">
          {canWriteProducts && allProducts && (
            <CommandItem value="action new product" onSelect={() => go("/products/new")}>
              <Plus />
              New product
            </CommandItem>
          )}
          {canInstall && (
            <CommandItem value="action install gateway app" onSelect={() => go("/apps")}>
              <Plus />
              Install a payment gateway
            </CommandItem>
          )}
          <CommandItem
            value="action toggle theme dark light"
            onSelect={() => {
              setTheme(resolvedTheme === "dark" ? "light" : "dark")
              onOpenChange(false)
            }}
          >
            {resolvedTheme === "dark" ? <Sun /> : <Moon />}
            Switch to {resolvedTheme === "dark" ? "light" : "dark"} theme
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
