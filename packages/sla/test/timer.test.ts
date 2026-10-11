import { describe, expect, it } from "vitest"
import { hours } from "../src/clock.ts"
import { defineSchedule, weekdayHours } from "../src/schedule.ts"
import {
  isPaused,
  pauseTimer,
  resumeTimer,
  type SlaTimer,
  startTimer,
  TimerError,
  timerDeadline,
  timerElapsed,
  timerPausedTime,
} from "../src/timer.ts"

const schedule = defineSchedule({ timeZone: "UTC", weekly: weekdayHours("09:00", "17:00") })
const at = (s: string): Date => new Date(s)

function unwrap(r: { ok: true; value: SlaTimer } | { ok: false; error: TimerError }): SlaTimer {
  if (!r.ok) throw r.error
  return r.value
}

describe("startTimer", () => {
  it("stores epoch milliseconds and survives JSON", () => {
    const t = startTimer(at("2026-03-02T09:00:00Z"), hours(8))
    expect(t).toEqual({
      startedAt: Date.parse("2026-03-02T09:00:00Z"),
      budgetMs: hours(8),
      pauses: [],
    })
    expect(JSON.parse(JSON.stringify(t))).toEqual(t)
  })

  it("rejects bad input", () => {
    expect(() => startTimer(at("x"), 1)).toThrow(RangeError)
    expect(() => startTimer(at("2026-03-02T09:00:00Z"), -1)).toThrow(RangeError)
    expect(() => startTimer(at("2026-03-02T09:00:00Z"), Number.POSITIVE_INFINITY)).toThrow(
      RangeError,
    )
  })
})

describe("pause and resume", () => {
  const start = startTimer(at("2026-03-02T09:00:00Z"), hours(8))

  it("moves the deadline out by the paused business time", () => {
    const paused = unwrap(pauseTimer(start, at("2026-03-02T11:00:00Z"), "waiting on requester"))
    expect(isPaused(paused)).toBe(true)
    expect(timerDeadline(schedule, paused)).toBeNull()
    const resumed = unwrap(resumeTimer(paused, at("2026-03-02T15:00:00Z")))
    expect(isPaused(resumed)).toBe(false)
    expect(resumed.pauses[0]?.reason).toBe("waiting on requester")
    expect(timerDeadline(schedule, resumed)?.toISOString()).toBe("2026-03-03T13:00:00.000Z")
    expect(timerElapsed(schedule, resumed, at("2026-03-02T17:00:00Z"))).toBe(hours(4))
    expect(timerPausedTime(schedule, resumed, at("2026-03-02T17:00:00Z"))).toBe(hours(4))
  })

  it("counts an open pause up to now", () => {
    const paused = unwrap(pauseTimer(start, at("2026-03-02T11:00:00Z")))
    expect(timerElapsed(schedule, paused, at("2026-03-02T16:00:00Z"))).toBe(hours(2))
    expect(timerPausedTime(schedule, paused, at("2026-03-02T16:00:00Z"))).toBe(hours(5))
  })

  it("does not count weekend time spent paused", () => {
    const paused = unwrap(pauseTimer(start, at("2026-03-06T16:00:00Z")))
    const resumed = unwrap(resumeTimer(paused, at("2026-03-09T09:00:00Z")))
    expect(timerPausedTime(schedule, resumed, at("2026-03-09T12:00:00Z"))).toBe(hours(1))
  })

  it("returns a past deadline when the budget ran out before a pause", () => {
    const paused = unwrap(pauseTimer(start, at("2026-03-03T12:00:00Z")))
    expect(timerDeadline(schedule, paused)?.toISOString()).toBe("2026-03-02T17:00:00.000Z")
  })

  it("does not mutate the original timer", () => {
    unwrap(pauseTimer(start, at("2026-03-02T11:00:00Z")))
    expect(start.pauses).toEqual([])
  })

  it("refuses out-of-order transitions", () => {
    const reason = (r: { ok: boolean; error?: TimerError }): string | undefined => r.error?.reason
    const paused = unwrap(pauseTimer(start, at("2026-03-02T11:00:00Z")))
    const resumed = unwrap(resumeTimer(paused, at("2026-03-02T12:00:00Z")))
    expect(reason(pauseTimer(paused, at("2026-03-02T12:00:00Z")))).toBe("already_paused")
    expect(reason(resumeTimer(start, at("2026-03-02T12:00:00Z")))).toBe("not_paused")
    expect(reason(pauseTimer(start, at("2026-03-02T08:00:00Z")))).toBe("before_start")
    expect(reason(pauseTimer(resumed, at("2026-03-02T11:30:00Z")))).toBe("out_of_order")
    expect(reason(resumeTimer(paused, at("2026-03-02T10:00:00Z")))).toBe("out_of_order")
    expect(reason(pauseTimer(start, at("bad")))).toBe("invalid_time")
    expect(reason(resumeTimer(paused, at("bad")))).toBe("invalid_time")
  })

  it("uses an AppError with a 409 status", () => {
    const r = pauseTimer(
      unwrap(pauseTimer(start, at("2026-03-02T11:00:00Z"))),
      at("2026-03-02T12:00:00Z"),
    )
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toBeInstanceOf(TimerError)
      expect(r.error.code).toBe("timer_invalid_transition")
      expect(r.error.status).toBe(409)
    }
  })
})

describe("timerElapsed", () => {
  it("is zero before the start and rejects an invalid now", () => {
    const t = startTimer(at("2026-03-02T09:00:00Z"), hours(8))
    expect(timerElapsed(schedule, t, at("2026-03-01T00:00:00Z"))).toBe(0)
    expect(() => timerElapsed(schedule, t, at("bad"))).toThrow(RangeError)
  })
})
