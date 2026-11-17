import { Suspense } from "react"
import { ClientGate } from "@/components/shared/client-gate"
import { Skeleton } from "@/components/ui/skeleton"
import { AuthGate } from "@/lib/auth"

function TourFallback() {
  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-4 py-20 sm:px-6" aria-busy>
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-10 w-2/3" />
      <Skeleton className="h-64 w-full rounded-2xl" />
    </div>
  )
}

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<TourFallback />}>
      <ClientGate fallback={<TourFallback />}>
        <AuthGate fallback={<TourFallback />}>{children}</AuthGate>
      </ClientGate>
    </Suspense>
  )
}
