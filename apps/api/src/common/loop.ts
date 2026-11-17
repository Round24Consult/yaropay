/**
 * Runs `tick` again and again, waiting `intervalMs()` between rounds. The interval is read before each
 * wait, so a change made while the app runs (Platform → Settings) applies from the next round. A round
 * never overlaps the previous one: the wait starts when it finishes.
 */
export function startLoop(intervalMs: () => number, tick: () => Promise<void>): { stop: () => void } {
  let timer: NodeJS.Timeout | null = null
  let stopped = false
  const schedule = () => {
    if (stopped) return
    timer = setTimeout(() => {
      void tick()
        .catch(() => undefined)
        .finally(schedule)
    }, intervalMs())
    timer.unref()
  }
  schedule()
  return {
    stop: () => {
      stopped = true
      if (timer) clearTimeout(timer)
    },
  }
}
