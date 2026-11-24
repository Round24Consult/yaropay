import { Suspense } from "react"
import { ClientGate } from "@/components/shared/client-gate"
import { Skeleton } from "@/components/ui/skeleton"
import { AuthGate } from "@/lib/auth"

/** Full-screen pages where a signed-in member approves something for an outside app (AI app sign-in). */
function ConnectFallback() {
  return (
    <div className="mx-auto w-full max-w-md space-y-4 px-4 py-20" aria-busy>
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-72 w-full rounded-2xl" />
    </div>
  )
}

export default function ConnectLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<ConnectFallback />}>
      <ClientGate fallback={<ConnectFallback />}>
        <AuthGate fallback={<ConnectFallback />}>{children}</AuthGate>
      </ClientGate>
    </Suspense>
  )
}
