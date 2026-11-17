"use client"

import { hasPermission, type Permission, type SessionUser } from "@yaropay/core/auth"
import { useRouter } from "next/navigation"
import * as React from "react"
import { ApiRequestError, loginUrl } from "@/lib/api/client"
import { useAuthState, useMeQuery } from "@/lib/api/hooks"

const MeContext = React.createContext<SessionUser | null>(null)

/** The signed-in member. Only valid inside <AuthGate>. */
export function useMe(): SessionUser {
  const me = React.useContext(MeContext)
  if (!me) throw new Error("useMe must be used inside <AuthGate>")
  return me
}

/** Whether the signed-in member has a permission. */
export function useCan(permission: Permission): boolean {
  return hasPermission(React.useContext(MeContext), permission)
}

/** False for members limited to some products: they cannot create products or see install-wide data. */
export function useHasAllProducts(): boolean {
  return React.useContext(MeContext)?.productIds === null
}

/**
 * Renders the dashboard only for a signed-in member. Signed-out visitors go to
 * /login (or /setup on a fresh install). Shows `fallback` while checking.
 */
export function AuthGate({ children, fallback }: { children: React.ReactNode; fallback: React.ReactNode }) {
  const router = useRouter()
  const me = useMeQuery()
  const signedOut = me.error instanceof ApiRequestError && me.error.status === 401
  const state = useAuthState({ enabled: signedOut })

  React.useEffect(() => {
    if (!signedOut) return
    if (state.data?.needsSetup) router.replace("/setup")
    else if (state.data || state.error) router.replace(loginUrl())
  }, [signedOut, state.data, state.error, router])

  if (me.data) return <MeContext.Provider value={me.data}>{children}</MeContext.Provider>
  if (me.error && !signedOut) return <ApiUnavailable error={me.error} onRetry={() => me.refetch()} />
  return <>{fallback}</>
}

function ApiUnavailable({ error, onRetry }: { error: Error; onRetry: () => void }) {
  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <div className="max-w-sm space-y-3 rounded-2xl border bg-card p-6 text-center shadow-card">
        <h1 className="text-base font-semibold">Can&apos;t reach the YaroPay API</h1>
        <p className="text-sm text-muted-foreground">{error.message}</p>
        <p className="text-xs text-muted-foreground">
          Start it with <code className="rounded bg-muted px-1 font-mono">npm run dev</code>, or point{" "}
          <code className="rounded bg-muted px-1 font-mono">YAROPAY_API_URL</code> at it.
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Try again
        </button>
      </div>
    </main>
  )
}
