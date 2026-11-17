"use client"

import * as React from "react"
import { DEFAULT_LAYOUT, WIDGETS, type WidgetId, type WidgetLayout } from "./widgets"

const KEY = "yaropay-dashboard-layout"

function load(): WidgetLayout {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULT_LAYOUT
    const parsed = JSON.parse(raw) as WidgetLayout
    const known = new Set(WIDGETS.map((w) => w.id))
    const order = parsed.order.filter((id) => known.has(id))
    for (const w of WIDGETS) if (!order.includes(w.id)) order.push(w.id)
    return { order, hidden: parsed.hidden.filter((id) => known.has(id)) }
  } catch {
    return DEFAULT_LAYOUT
  }
}

/** Per-viewer dashboard layout (order + visibility), kept in this browser only. */
export function useWidgetLayout() {
  const [layout, setLayout] = React.useState<WidgetLayout>(DEFAULT_LAYOUT)
  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLayout(load())
  }, [])
  const save = React.useCallback((next: WidgetLayout) => {
    setLayout(next)
    try {
      localStorage.setItem(KEY, JSON.stringify(next))
    } catch {
      // Storage blocked: layout lasts for this visit.
    }
  }, [])
  const toggle = (id: WidgetId) =>
    save({ ...layout, hidden: layout.hidden.includes(id) ? layout.hidden.filter((h) => h !== id) : [...layout.hidden, id] })
  const reorder = (order: WidgetId[]) => save({ ...layout, order })
  const reset = () => save(DEFAULT_LAYOUT)
  return { layout, toggle, reorder, reset }
}
