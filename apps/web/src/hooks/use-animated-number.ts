"use client"

import { animate } from "motion"
import * as React from "react"

/** Tweens a number when it changes (skipped for reduced motion). */
export function useAnimatedNumber(value: number, duration = 0.6) {
  const [display, setDisplay] = React.useState(value)
  const from = React.useRef(value)
  React.useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    if (reduce || from.current === value) {
      from.current = value
      setDisplay(value)
      return
    }
    const controls = animate(from.current, value, {
      duration,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => setDisplay(v),
    })
    from.current = value
    return () => controls.stop()
  }, [value, duration])
  return display
}
