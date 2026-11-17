import { Suspense } from "react"
import { ClientGate } from "./client-gate"
import { PageSkeleton } from "./page-skeleton"

/** Page wrapper: Suspense for URL state plus the hydration gate for client data. */
export function View({ children, fallback = <PageSkeleton /> }: { children: React.ReactNode; fallback?: React.ReactNode }) {
  return (
    <Suspense fallback={fallback}>
      <ClientGate fallback={fallback}>{children}</ClientGate>
    </Suspense>
  )
}
