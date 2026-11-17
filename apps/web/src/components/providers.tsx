"use client"

import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { NuqsAdapter } from "nuqs/adapters/next/app"
import * as React from "react"
import { ThemeProvider } from "@/components/theme/theme-provider"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Toaster } from "@/components/ui/sonner"
import { qk } from "@/lib/api/keys"
import { ModeProvider } from "@/lib/mode"

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = React.useState(() => {
    const qc: QueryClient = new QueryClient({
      defaultOptions: {
        queries: { staleTime: 15_000, refetchOnWindowFocus: false, retry: 1 },
      },
      // Almost any change (keys, products, settings, invites, test events) can move the setup guide along.
      // Not awaited, so no mutation waits for this refetch.
      mutationCache: new MutationCache({
        onSettled: () => {
          void qc.invalidateQueries({ queryKey: qk.onboarding })
        },
      }),
    })
    return qc
  })
  return (
    <ThemeProvider>
      <QueryClientProvider client={client}>
        <NuqsAdapter>
          <ModeProvider>
            <TooltipProvider delayDuration={200}>
              {children}
              <Toaster position="bottom-right" richColors={false} />
            </TooltipProvider>
          </ModeProvider>
        </NuqsAdapter>
      </QueryClientProvider>
    </ThemeProvider>
  )
}
