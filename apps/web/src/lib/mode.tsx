"use client"

import * as React from "react"
import type { Mode } from "@yaropay/core/types"

const KEY = "yaropay-mode"

interface ModeContextValue {
  mode: Mode
  setMode: (m: Mode) => void
}

const ModeContext = React.createContext<ModeContextValue | null>(null)

/** Test/Live switch, like a gateway dashboard. Remembered per browser. */
export function ModeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = React.useState<Mode>("live")
  React.useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (localStorage.getItem(KEY) === "test") setModeState("test")
    } catch {
      // ignore
    }
  }, [])
  const setMode = React.useCallback((m: Mode) => {
    setModeState(m)
    try {
      localStorage.setItem(KEY, m)
    } catch {
      // ignore
    }
  }, [])
  const value = React.useMemo(() => ({ mode, setMode }), [mode, setMode])
  return <ModeContext.Provider value={value}>{children}</ModeContext.Provider>
}

export function useMode() {
  const ctx = React.useContext(ModeContext)
  if (!ctx) throw new Error("useMode must be used inside ModeProvider")
  return ctx
}
