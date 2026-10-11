import { describe, expect, it } from "vitest"
import { hours, minutes } from "../src/clock.ts"
import { defineSchedule, weekdayHours } from "../src/schedule.ts"
import {
  budgetFor,
  DEFAULT_ESCALATION_TIERS,
  DEFAULT_PRIORITY_BUDGETS,
  DEFAULT_THRESHOLDS,
  escalationTier,
  evaluate,
  evaluateMany,
  formatRemaining,
  levelFor,
  SLA_LEVEL_LABELS,
  SLA_LEVELS,
  validatePriorityBudgets,
  validateThresholds,
} from "../src/status.ts"
import { pauseTimer, startTimer } from "../src/timer.ts"

const schedule = defineSchedule({ timeZone: "UTC", weekly: weekdayHours("09:00", "17:00") })
const at = (s: string): Date => new Date(s)
const startedAt = at("2026-03-02T09:00:00Z")

describe("budgets and levels", () => {
  it("looks up priority budgets", () => {
    expect(budgetFor(DEFAULT_PRIORITY_BUDGETS, "urgent")).toBe(hours(4))
    expect(budgetFor(DEFAULT_PRIORITY_BUDGETS, "low")).toBe(hours(72))
    expect(budgetFor({ p1: hours(1), p2: hours(2) }, "p2")).toBe(hours(2))
    expect(() => budgetFor(DEFAULT_PRIORITY_BUDGETS, "toString" as "low")).toThrow(RangeError)
  })

  it("maps fractions to levels at the thresholds", () => {
    expect(levelFor(0)).toBe("on_track")
    expect(levelFor(0.5)).toBe("approaching")
    expect(levelFor(0.75)).toBe("warning")
    expect(levelFor(0.9)).toBe("critical")
    expect(levelFor(1)).toBe("breached")
    expect(levelFor(0.6, { approaching: 0.2, warning: 0.4, critical: 0.6 })).toBe("critical")
    expect(() => levelFor(Number.NaN)).toThrow(RangeError)
  })

  it("labels every level", () => {
    expect(SLA_LEVELS.map((l) => SLA_LEVEL_LABELS[l])).toEqual([
      "On track",
      "Approaching",
      "Warning",
      "Critical",
      "Breached",
    ])
  })
})

describe("evaluate", () => {
  it("reports a warning six hours into eight", () => {
    const s = evaluate(schedule, { startedAt, budgetMs: hours(8) }, at("2026-03-02T15:00:00Z"))
    expect(s).toEqual({
      level: "warning",
      fraction: 0.75,
      elapsedMs: hours(6),
      remainingMs: hours(2),
      deadline: at("2026-03-02T17:00:00Z"),
      breached: false,
      atRisk: true,
      paused: false,
      displayText: "2h remaining",
    })
  })

  it("does not age over the weekend", () => {
    const fri = at("2026-03-06T13:00:00Z")
    const s = evaluate(schedule, { startedAt: fri, budgetMs: hours(8) }, at("2026-03-09T09:00:00Z"))
    expect(s.level).toBe("approaching")
    expect(s.elapsedMs).toBe(hours(4))
  })

  it("reports a breach at exactly the budget and beyond", () => {
    const exact = evaluate(schedule, { startedAt, budgetMs: hours(8) }, at("2026-03-02T17:00:00Z"))
    expect(exact).toMatchObject({
      level: "breached",
      breached: true,
      atRisk: false,
      remainingMs: 0,
    })
    const over = evaluate(schedule, { startedAt, budgetMs: hours(8) }, at("2026-03-03T10:30:00Z"))
    expect(over.fraction).toBe(9.5 / 8)
    expect(over.displayText).toBe("1h 30m overdue")
  })

  it("treats a zero budget as breached", () => {
    expect(evaluate(schedule, { startedAt, budgetMs: 0 }, startedAt).level).toBe("breached")
  })

  it("accepts a paused timer", () => {
    const r = pauseTimer(startTimer(startedAt, hours(8)), at("2026-03-02T11:00:00Z"))
    if (!r.ok) throw r.error
    const s = evaluate(schedule, r.value, at("2026-03-02T16:00:00Z"))
    expect(s).toMatchObject({
      paused: true,
      deadline: null,
      elapsedMs: hours(2),
      level: "on_track",
    })
  })

  it("honours custom thresholds and atRiskFrom", () => {
    const s = evaluate(schedule, { startedAt, budgetMs: hours(8) }, at("2026-03-02T13:00:00Z"), {
      thresholds: { approaching: 0.25, warning: 0.4, critical: 0.8 },
      atRiskFrom: "critical",
    })
    expect(s.level).toBe("warning")
    expect(s.atRisk).toBe(false)
  })

  it("rejects bad input", () => {
    expect(() => evaluate(schedule, { startedAt: at("bad"), budgetMs: 1 })).toThrow(RangeError)
    expect(() => evaluate(schedule, { startedAt, budgetMs: -1 })).toThrow(RangeError)
  })

  it("evaluates many items against one now", () => {
    const out = evaluateMany(
      schedule,
      [
        { id: "a", startedAt, budgetMs: hours(4) },
        { id: "b", startedAt, budgetMs: hours(24) },
      ],
      at("2026-03-02T13:00:00Z"),
    )
    expect(out.get("a")?.level).toBe("breached")
    expect(out.get("b")?.level).toBe("on_track")
  })
})

describe("formatRemaining", () => {
  it("formats remaining and overdue time, floored to the minute", () => {
    expect(formatRemaining(hours(2) + minutes(30))).toBe("2h 30m remaining")
    expect(formatRemaining(-minutes(75))).toBe("1h 15m overdue")
    expect(formatRemaining(59_000)).toBe("0m remaining")
    expect(formatRemaining(0)).toBe("0m remaining")
    expect(() => formatRemaining(Number.NaN)).toThrow(RangeError)
  })
})

describe("escalation", () => {
  it("picks the highest tier reached", () => {
    expect(escalationTier(0.4)).toBeUndefined()
    expect(escalationTier(0.8)?.name).toBe("Lead alert")
    expect(escalationTier(1.2)?.notify).toContain("admin")
    const unsorted = [...DEFAULT_ESCALATION_TIERS].reverse()
    expect(escalationTier(0.95, unsorted)?.name).toBe("Critical")
  })
})

describe("validation", () => {
  it("validates thresholds", () => {
    expect(validateThresholds(DEFAULT_THRESHOLDS).ok).toBe(true)
    const bad = validateThresholds({ approaching: 0.8, warning: 0.7, critical: 1.2 })
    expect(bad.ok ? [] : bad.error.issues.map((i) => i.path)).toEqual(["critical"])
    const order = validateThresholds({ approaching: 0.8, warning: 0.7, critical: 0.6 })
    expect(order.ok ? [] : order.error.issues.map((i) => i.path)).toEqual(["warning", "critical"])
  })

  it("validates priority budgets", () => {
    expect(validatePriorityBudgets(DEFAULT_PRIORITY_BUDGETS).ok).toBe(true)
    const bad = validatePriorityBudgets({ a: -1, b: Number.NaN, c: 5 })
    expect(bad.ok ? [] : bad.error.issues.map((i) => i.path)).toEqual(["a", "b"])
    expect(validatePriorityBudgets(null as unknown as Record<string, number>).ok).toBe(false)
  })
})
