/**
 * A pausable SLA timer as plain, JSON-serializable data. Pausing stops the
 * clock (for example while waiting on the requester); business time inside a
 * pause does not count against the budget, and the deadline moves out by it.
 *
 * Timers are immutable: `pauseTimer` and `resumeTimer` return a new timer, or
 * an error when the call is out of order. Instants are stored as epoch
 * milliseconds so a timer survives `JSON.stringify` round trips unchanged.
 *
 * @example
 * ```ts
 * import { defineSchedule, weekdayHours } from "@bib/sla/schedule"
 * import { hours } from "@bib/sla/clock"
 * import { startTimer, pauseTimer, resumeTimer, timerDeadline } from "@bib/sla/timer"
 *
 * const schedule = defineSchedule({ timeZone: "UTC", weekly: weekdayHours("09:00", "17:00") })
 * let timer = startTimer(new Date("2026-03-02T09:00:00Z"), hours(8)) // Monday 09:00
 * const paused = pauseTimer(timer, new Date("2026-03-02T11:00:00Z"))
 * if (paused.ok) timer = paused.value
 * const resumed = resumeTimer(timer, new Date("2026-03-02T15:00:00Z"))
 * if (resumed.ok) timer = resumed.value
 * timerDeadline(schedule, timer) // 2026-03-03T13:00:00.000Z (4 paused hours added)
 * ```
 */

import { AppError } from "@bib/shared/errors"
import { err, ok, type Result } from "@bib/shared/result"
import { addBusinessTime, businessTimeBetween } from "./clock.ts"
import type { Schedule } from "./schedule.ts"

/** One pause. `to` is absent while the timer is still paused. */
export interface TimerPause {
  readonly from: number
  readonly to?: number
  readonly reason?: string
}

/** Serializable timer state. Instants are epoch milliseconds. */
export interface SlaTimer {
  readonly startedAt: number
  /** Business-time budget in milliseconds. */
  readonly budgetMs: number
  readonly pauses: readonly TimerPause[]
}

/** Why a pause or resume was refused. */
export type TimerErrorCode =
  | "already_paused"
  | "not_paused"
  | "before_start"
  | "out_of_order"
  | "invalid_time"

/** A pause/resume call that would corrupt the timer. */
export class TimerError extends AppError {
  readonly reason: TimerErrorCode
  constructor(reason: TimerErrorCode, message: string) {
    super("timer_invalid_transition", message, 409)
    this.name = "TimerError"
    this.reason = reason
  }
}

function instant(date: Date, name: string): number {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new RangeError(`${name} must be a valid Date`)
  }
  return date.getTime()
}

/** A running timer started at `at` with `budgetMs` of business time. */
export function startTimer(at: Date, budgetMs: number): SlaTimer {
  if (typeof budgetMs !== "number" || !Number.isFinite(budgetMs) || budgetMs < 0) {
    throw new RangeError(`budgetMs must be a finite, non-negative number, got ${budgetMs}`)
  }
  return { startedAt: instant(at, "at"), budgetMs, pauses: [] }
}

/** True while the most recent pause has not been resumed. */
export function isPaused(timer: SlaTimer): boolean {
  const last = timer.pauses.at(-1)
  return last !== undefined && last.to === undefined
}

function lastEvent(timer: SlaTimer): number {
  const last = timer.pauses.at(-1)
  return last === undefined ? timer.startedAt : (last.to ?? last.from)
}

/** Stop the clock at `at`. Fails if already paused or if `at` is before the last event. */
export function pauseTimer(
  timer: SlaTimer,
  at: Date,
  reason?: string,
): Result<SlaTimer, TimerError> {
  if (!(at instanceof Date) || Number.isNaN(at.getTime())) {
    return err(new TimerError("invalid_time", "pause time must be a valid Date"))
  }
  const t = at.getTime()
  if (isPaused(timer)) return err(new TimerError("already_paused", "timer is already paused"))
  if (t < timer.startedAt) {
    return err(new TimerError("before_start", "cannot pause before the timer started"))
  }
  if (t < lastEvent(timer)) {
    return err(new TimerError("out_of_order", "cannot pause before the previous resume"))
  }
  const pause: TimerPause = reason === undefined ? { from: t } : { from: t, reason }
  return ok({ ...timer, pauses: [...timer.pauses, pause] })
}

/** Restart the clock at `at`. Fails if not paused or if `at` is before the pause began. */
export function resumeTimer(timer: SlaTimer, at: Date): Result<SlaTimer, TimerError> {
  if (!(at instanceof Date) || Number.isNaN(at.getTime())) {
    return err(new TimerError("invalid_time", "resume time must be a valid Date"))
  }
  const t = at.getTime()
  const last = timer.pauses.at(-1)
  if (last === undefined || last.to !== undefined) {
    return err(new TimerError("not_paused", "timer is not paused"))
  }
  if (t < last.from)
    return err(new TimerError("out_of_order", "cannot resume before the pause began"))
  return ok({ ...timer, pauses: [...timer.pauses.slice(0, -1), { ...last, to: t }] })
}

/** Running stretches `[from, to)`; the last has `to: undefined` when the timer is running. */
function runningSegments(timer: SlaTimer): Array<{ from: number; to: number | undefined }> {
  const out: Array<{ from: number; to: number | undefined }> = []
  let from = timer.startedAt
  for (const p of timer.pauses) {
    out.push({ from, to: p.from })
    if (p.to === undefined) return out
    from = p.to
  }
  out.push({ from, to: undefined })
  return out
}

/** Business time counted against the budget up to `now` (pauses excluded). */
export function timerElapsed(schedule: Schedule, timer: SlaTimer, now: Date): number {
  const n = instant(now, "now")
  let total = 0
  for (const seg of runningSegments(timer)) {
    if (seg.from >= n) break
    const end = Math.min(seg.to ?? n, n)
    total += businessTimeBetween(schedule, new Date(seg.from), new Date(end))
  }
  return total
}

/** Business time spent paused up to `now` (an open pause counts up to `now`). */
export function timerPausedTime(schedule: Schedule, timer: SlaTimer, now: Date): number {
  const n = instant(now, "now")
  let total = 0
  for (const p of timer.pauses) {
    if (p.from >= n) break
    total += businessTimeBetween(schedule, new Date(p.from), new Date(Math.min(p.to ?? n, n)))
  }
  return total
}

/**
 * When the budget runs out. While paused, returns `null` unless the budget was
 * already used up before the pause began (then that past instant).
 */
export function timerDeadline(schedule: Schedule, timer: SlaTimer): Date | null {
  let remaining = timer.budgetMs
  for (const seg of runningSegments(timer)) {
    const from = new Date(seg.from)
    if (seg.to === undefined) return addBusinessTime(schedule, from, remaining)
    const available = businessTimeBetween(schedule, from, new Date(seg.to))
    if (remaining <= available) return addBusinessTime(schedule, from, remaining)
    remaining -= available
  }
  return null
}
