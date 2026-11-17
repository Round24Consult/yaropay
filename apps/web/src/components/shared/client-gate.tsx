"use client"

import * as React from "react"

const subscribe = () => () => {}

/** True after hydration. During SSR and hydration it returns false. */
export function useHydrated() {
  return React.useSyncExternalStore(subscribe, () => true, () => false)
}

/**
 * All data here is fetched in the browser, so the server can only render a
 * skeleton. Rendering the fallback during hydration too keeps server and
 * client HTML identical, even when cached query data is already available.
 */
export function ClientGate({ fallback, children }: { fallback: React.ReactNode; children: React.ReactNode }) {
  return useHydrated() ? <>{children}</> : <>{fallback}</>
}
