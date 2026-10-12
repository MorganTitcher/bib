/**
 * Business-time arithmetic on a {@link Schedule}: deadlines, elapsed business
 * time, and open/closed queries. Durations are milliseconds; use
 * {@link hours} and {@link minutes} to write them.
 *
 * Business time is real elapsed time inside opening hours. An all-day
 * `00:00-24:00` shift is 23 hours long on a spring-forward day and 25 on a
 * fall-back day.
 *
 * @example
 * ```ts
 * import { defineSchedule, weekdayHours } from "@bib/sla/schedule"
 * import { addBusinessTime, businessTimeBetween, hours } from "@bib/sla/clock"
 *
 * const schedule = defineSchedule({ timeZone: "Europe/London", weekly: weekdayHours("09:00", "17:00") })
 * // Friday 15:00 + 4 business hours = Monday 11:00
 * addBusinessTime(schedule, new Date("2026-03-13T15:00:00Z"), hours(4)) // 2026-03-16T11:00:00.000Z
 * businessTimeBetween(schedule, new Date("2026-03-13T15:00:00Z"), new Date("2026-03-16T11:00:00Z")) // 14_400_000
 * ```
 */

import { MS_PER_HOUR, MS_PER_MINUTE } from "@bib/shared/dates"
import { type BusinessInterval, MAX_CLOSED_DAY_RUN, type Schedule } from "./schedule.ts"
import { localDateOf, shiftIsoDate } from "./zone.ts"

/** `n` hours in milliseconds. */
export function hours(n: number): number {
  return n * MS_PER_HOUR
}

/** `n` minutes in milliseconds. */
export function minutes(n: number): number {
  return n * MS_PER_MINUTE
}

function assertInstant(date: Date, name: string): number {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new RangeError(`${name} must be a valid Date`)
  }
  return date.getTime()
}

function assertDuration(ms: number, name: string): void {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) {
    throw new RangeError(`${name} must be a finite, non-negative number of milliseconds, got ${ms}`)
  }
}

/**
 * Business intervals that end after `fromMs`, in time order, clipped so none
 * starts before `fromMs` or before the end of the previous one (overnight
 * shifts may overlap the next day's hours). Throws `RangeError` after
 * {@link MAX_CLOSED_DAY_RUN} consecutive days with no business time.
 */
export function* businessIntervalsFrom(
  schedule: Schedule,
  from: Date,
): Generator<BusinessInterval, never, undefined> {
  let cursor = assertInstant(from, "from")
  // Start a day early: yesterday's overnight shift may still be running.
  let day = shiftIsoDate(localDateOf(from, schedule.timeZone), -1)
  let emptyRun = 0
  for (;;) {
    let yielded = false
    for (const iv of schedule.intervalsOn(day)) {
      const end = iv.end.getTime()
      if (end <= cursor) continue
      const start = Math.max(iv.start.getTime(), cursor)
      yielded = true
      yield { start: new Date(start), end: iv.end }
      cursor = end
    }
    if (yielded || schedule.intervalsOn(day).length > 0) emptyRun = 0
    else if (++emptyRun >= MAX_CLOSED_DAY_RUN) {
      throw new RangeError(`no business time within ${MAX_CLOSED_DAY_RUN} days of ${day}`)
    }
    day = shiftIsoDate(day, 1)
  }
}

/**
 * The instant at which `durationMs` of business time has passed since `start`.
 *
 * - Starting outside hours, the clock starts at the next opening.
 * - A duration that exactly uses up a shift ends **at** its closing time, not
 *   at the next opening.
 * - A zero duration returns `start` if the schedule is open then, otherwise
 *   the next opening.
 */
export function addBusinessTime(schedule: Schedule, start: Date, durationMs: number): Date {
  assertDuration(durationMs, "durationMs")
  let remaining = durationMs
  for (const iv of businessIntervalsFrom(schedule, start)) {
    const a = iv.start.getTime()
    const available = iv.end.getTime() - a
    if (remaining <= available) return new Date(a + remaining)
    remaining -= available
  }
  /* c8 ignore next */
  throw new Error("unreachable")
}

/**
 * Business time between two instants, in milliseconds. Negative when `to` is
 * before `from`.
 */
export function businessTimeBetween(schedule: Schedule, from: Date, to: Date): number {
  const a = assertInstant(from, "from")
  const b = assertInstant(to, "to")
  if (b < a) return -businessTimeBetween(schedule, to, from)
  let total = 0
  for (const iv of businessIntervalsFrom(schedule, from)) {
    const s = iv.start.getTime()
    if (s >= b) break
    total += Math.min(iv.end.getTime(), b) - s
    if (iv.end.getTime() >= b) break
  }
  return total
}

/** True when `at` falls inside opening hours (start inclusive, end exclusive). */
export function isOpen(schedule: Schedule, at: Date): boolean {
  const t = assertInstant(at, "at")
  const today = localDateOf(at, schedule.timeZone)
  for (const day of [shiftIsoDate(today, -1), today]) {
    for (const iv of schedule.intervalsOn(day)) {
      if (iv.start.getTime() <= t && t < iv.end.getTime()) return true
    }
  }
  return false
}

/** `at` when open, otherwise the next instant the schedule opens. */
export function nextOpening(schedule: Schedule, at: Date): Date {
  for (const iv of businessIntervalsFrom(schedule, at)) return iv.start
  /* c8 ignore next */
  throw new Error("unreachable")
}

/**
 * When the current open stretch ends. Back-to-back shifts (for example
 * `00:00-24:00` on consecutive days) count as one stretch. Returns `at` itself
 * when the schedule is already closed, and `undefined` when it stays open for
 * more than `horizonDays` (a 24/7 schedule).
 */
export function nextClosing(schedule: Schedule, at: Date, horizonDays = 366): Date | undefined {
  const t = assertInstant(at, "at")
  const limit = t + horizonDays * 86_400_000
  let end: number | undefined
  for (const iv of businessIntervalsFrom(schedule, at)) {
    const s = iv.start.getTime()
    if (end === undefined) {
      if (s > t) end = t
      else end = iv.end.getTime()
    } else if (s > end) break
    else end = iv.end.getTime()
    if (end > limit) return undefined
    if (end === t) break
  }
  return end === undefined ? undefined : new Date(end)
}

/** Plain wall-clock deadline: `start + durationMs`, ignoring opening hours (24/7 targets). */
export function addCalendarTime(start: Date, durationMs: number): Date {
  const t = assertInstant(start, "start")
  assertDuration(durationMs, "durationMs")
  return new Date(t + durationMs)
}
