import { ConsoleLogger, Logger } from "@nestjs/common"
import { afterEach, describe, expect, it, vi } from "vitest"
import { levelsUpTo, setRuntimeLogLevel } from "../src/common/log-level.js"
import { startLoop } from "../src/common/loop.js"

describe("worker loop", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it("reads the interval before every wait, so a change applies from the next round", async () => {
    vi.useFakeTimers()
    let interval = 1_000
    const tick = vi.fn(async () => undefined)
    const loop = startLoop(() => interval, tick)

    await vi.advanceTimersByTimeAsync(999)
    expect(tick).toHaveBeenCalledTimes(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(tick).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(tick).toHaveBeenCalledTimes(2)

    // Changed while it runs: the round already waiting keeps its 1 s, the next ones wait 5 s.
    interval = 5_000
    await vi.advanceTimersByTimeAsync(1_000)
    expect(tick).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(4_999)
    expect(tick).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(1)
    expect(tick).toHaveBeenCalledTimes(4)

    loop.stop()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(tick).toHaveBeenCalledTimes(4)
  })

  it("never overlaps rounds, and keeps going after a round fails", async () => {
    vi.useFakeTimers()
    let running = 0
    let overlapped = false
    let calls = 0
    const loop = startLoop(
      () => 100,
      async () => {
        calls++
        running++
        if (running > 1) overlapped = true
        await new Promise((r) => setTimeout(r, 250))
        running--
        if (calls === 1) throw new Error("boom")
      },
    )
    await vi.advanceTimersByTimeAsync(2_000)
    expect(overlapped).toBe(false)
    expect(calls).toBeGreaterThan(3)
    loop.stop()
  })
})

describe("runtime log level", () => {
  const original = (Logger as unknown as { staticInstanceRef: unknown }).staticInstanceRef

  afterEach(() => {
    Logger.overrideLogger(original as ConsoleLogger)
    vi.restoreAllMocks()
  })

  it("maps a level to that level and every quieter one", () => {
    expect(levelsUpTo("error")).toEqual(["error"])
    expect(levelsUpTo("log")).toEqual(["error", "warn", "log"])
    expect(levelsUpTo("verbose")).toEqual(["error", "warn", "log", "debug", "verbose"])
  })

  it("changes what a running logger prints, including loggers created earlier", () => {
    Logger.overrideLogger(new ConsoleLogger({ logLevels: levelsUpTo("log"), colors: false }))
    const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true)
    const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
    const logger = new Logger("Test")
    const printed = () => [...out.mock.calls, ...err.mock.calls].map((c) => String(c[0])).join("")

    logger.log("before change")
    expect(printed()).toContain("before change")

    setRuntimeLogLevel("error")
    logger.log("hidden log line")
    logger.warn("hidden warning")
    logger.error("shown error")
    expect(printed()).not.toContain("hidden log line")
    expect(printed()).not.toContain("hidden warning")
    expect(printed()).toContain("shown error")

    setRuntimeLogLevel("debug")
    logger.debug("shown debug line")
    expect(printed()).toContain("shown debug line")
  })
})
