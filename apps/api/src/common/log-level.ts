import { Logger, type LogLevel as NestLogLevel } from "@nestjs/common"
import { LOG_LEVELS, type LogLevel } from "@yaropay/core/platform"

/** The levels Nest prints for a chosen level: that level and every quieter one ("log" → error, warn, log). */
export function levelsUpTo(level: LogLevel): NestLogLevel[] {
  return LOG_LEVELS.slice(0, LOG_LEVELS.indexOf(level) + 1)
}

/**
 * Changes what the running API logs. Reaches the app's logger and every `new Logger(...)` already
 * created. When logging is off altogether (the tests' `logger: false`) it stays off.
 */
export function setRuntimeLogLevel(level: LogLevel) {
  Logger.overrideLogger(levelsUpTo(level))
}
