"use client"

import * as React from "react"
import { THEME_STORAGE_KEY } from "./theme-script"

export type ThemeChoice = "light" | "dark" | "system"

interface ThemeContextValue {
  theme: ThemeChoice
  resolvedTheme: "light" | "dark"
  setTheme: (t: ThemeChoice) => void
}

const ThemeContext = React.createContext<ThemeContextValue | null>(null)

function readStored(): ThemeChoice {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY)
    return v === "light" || v === "dark" ? v : "system"
  } catch {
    return "system"
  }
}

function systemDark() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches
}

function apply(resolved: "light" | "dark") {
  const root = document.documentElement
  root.classList.toggle("dark", resolved === "dark")
  root.setAttribute("data-theme", resolved)
  root.style.colorScheme = resolved
}

const subscribeNoop = () => () => {}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // The inline head script already applied the theme; read it after hydration.
  const hydrated = React.useSyncExternalStore(subscribeNoop, () => true, () => false)
  const [theme, setThemeState] = React.useState<ThemeChoice>("system")
  const [isSystemDark, setSystemDark] = React.useState(false)

  React.useEffect(() => {
    // Sync from storage once mounted (storage is unavailable on the server).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setThemeState(readStored())
    setSystemDark(systemDark())
    const mq = window.matchMedia("(prefers-color-scheme: dark)")
    const onChange = () => setSystemDark(mq.matches)
    mq.addEventListener("change", onChange)
    return () => mq.removeEventListener("change", onChange)
  }, [])

  const resolvedTheme: "light" | "dark" = theme === "system" ? (isSystemDark ? "dark" : "light") : theme

  React.useEffect(() => {
    if (hydrated) apply(resolvedTheme)
  }, [hydrated, resolvedTheme])

  const setTheme = React.useCallback((t: ThemeChoice) => {
    setThemeState(t)
    try {
      localStorage.setItem(THEME_STORAGE_KEY, t)
    } catch {
      // Storage blocked: the choice lasts for this page view only.
    }
  }, [])

  const value = React.useMemo(() => ({ theme, resolvedTheme, setTheme }), [theme, resolvedTheme, setTheme])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const ctx = React.useContext(ThemeContext)
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider")
  return ctx
}
