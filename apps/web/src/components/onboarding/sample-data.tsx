"use client"

import { FlaskConical, Trash2 } from "lucide-react"
import { useRouter } from "next/navigation"
import * as React from "react"
import { toast } from "sonner"
import { Panel, PanelHeader } from "@/components/shared/page-header"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"
import { useLoadSampleData, useOnboarding, useRemoveSampleData } from "@/lib/api/hooks"
import { useCan } from "@/lib/auth"

/** Loads the sample company. Returns a handler that toasts the outcome. */
export function useLoadSample() {
  const load = useLoadSampleData()
  return {
    pending: load.isPending,
    // mutateAsync, not mutate: the button that started it unmounts as soon as products appear,
    // and per-call mutate callbacks are skipped after unmount.
    run: async (onDone?: () => void) => {
      try {
        await load.mutateAsync()
        toast.success("Sample data loaded", { description: "Three made-up products with a year of payments. Remove them from the banner when you're done." })
        onDone?.()
      } catch (e) {
        toast.error((e as Error).message)
      }
    },
  }
}

/** "Remove sample data" with a confirmation that says exactly what goes and what stays. */
export function RemoveSampleDataButton({ variant = "outline", size = "sm" }: { variant?: "outline" | "ghost"; size?: "sm" | "xs" }) {
  const router = useRouter()
  const remove = useRemoveSampleData()
  const [open, setOpen] = React.useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant={variant} size={size} onClick={() => setOpen(true)} data-testid="remove-sample">
        <Trash2 /> Remove sample data
      </Button>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Remove sample data?</DialogTitle>
          <DialogDescription>
            This deletes the sample products and gateway accounts with all their payments, events and deliveries. Your own products, gateway accounts, settings and
            team stay as they are.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Keep it</Button>
          </DialogClose>
          <Button
            variant="destructive"
            disabled={remove.isPending}
            data-testid="confirm-remove-sample"
            onClick={async () => {
              // mutateAsync: the banner holding this dialog unmounts once the sample data is gone.
              try {
                const r = await remove.mutateAsync()
                setOpen(false)
                toast.success("Sample data removed", {
                  description: `${r.products} products, ${r.connections} gateway accounts and ${r.transactions.toLocaleString()} payments deleted.`,
                })
                // Pages for sample products and accounts no longer exist.
                if (/^\/(products|apps)\/.+/.test(window.location.pathname)) router.push("/")
              } catch (e) {
                toast.error((e as Error).message)
              }
            }}
          >
            {remove.isPending && <Spinner />} Remove sample data
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** A slim strip above every page while sample data is loaded, so nobody mistakes it for real money. */
export function SampleDataBanner() {
  const { data } = useOnboarding()
  const canRemove = useCan("settings:write")
  if (!data?.sampleData.present) return null
  return (
    <div role="status" data-testid="sample-banner" className="border-b border-dashed bg-[repeating-linear-gradient(-45deg,transparent,transparent_8px,color-mix(in_oklch,var(--warning)_7%,transparent)_8px,color-mix(in_oklch,var(--warning)_7%,transparent)_16px)]">
      <div className="mx-auto flex w-full max-w-[1400px] flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2 md:px-6">
        <FlaskConical className="size-4 shrink-0 text-warning-text" aria-hidden />
        <p className="min-w-0 flex-1 text-sm">
          <span className="font-medium">You&apos;re exploring sample data.</span>{" "}
          <span className="text-muted-foreground">Products and gateway accounts marked Sample are made up and never send real requests.</span>
        </p>
        {canRemove && <RemoveSampleDataButton variant="ghost" size="xs" />}
      </div>
    </div>
  )
}

/** Settings > General: load sample data into an empty install, or remove it. */
export function SampleDataPanel() {
  const { data } = useOnboarding()
  const sample = useLoadSample()
  if (!data) return null
  const { present, canLoad } = data.sampleData
  return (
    <Panel data-testid="sample-panel">
      <PanelHeader
        title="Sample data"
        description="A made-up company with three products, gateway accounts with fake keys and a year of payments, for trying the dashboard before your own data arrives."
      />
      <div className="flex flex-col gap-3 p-5 pt-3 sm:flex-row sm:items-center">
        <p className="flex-1 text-sm text-muted-foreground">
          {present
            ? "Sample data is loaded. Removing it leaves your own products, gateway accounts and team untouched."
            : canLoad
              ? "Your install is empty, so sample data can be loaded now."
              : "Sample data can only be loaded into an empty install, before any product or gateway account exists."}
        </p>
        {present ? (
          <RemoveSampleDataButton />
        ) : (
          <Button variant="outline" size="sm" disabled={!canLoad || sample.pending} onClick={() => sample.run()} data-testid="load-sample">
            {sample.pending ? <Spinner /> : <FlaskConical />} Load sample data
          </Button>
        )}
      </div>
    </Panel>
  )
}
