/**
 * SLA status: how much of the business-time budget is used, which warning
 * level that is, whether it is breached or at risk, and who to escalate to.
 *
 * Levels come from the fraction of the budget used, measured in **business**
 * time, so a ticket opened on Friday afternoon does not turn red over the
 * weekend:
 *
 * | fraction used | level |
 * |---|---|
 * | `< approaching` | `on_track` |
 * | `>= approaching` | `approaching` |
 * | `>= warning` | `warning` |
 * | `>= critical` | `critical` |
 * | `>= 1` | `breached` |
 *
 * @example
 * ```ts
 * import { defineSchedule, weekdayHours } from "@bib/sla/schedule"
 * import { evaluate, budgetFor, DEFAULT_PRIORITY_BUDGETS } from "@bib/sla/status"
 *
 * const schedule = defineSchedule({ timeZone: "UTC", weekly: weekdayHours("09:00", "17:00") })
 * const status = evaluate(schedule, {
 *   startedAt: new Date("2026-03-02T09:00:00Z"),
 *   budgetMs: budgetFor(DEFAULT_PRIORITY_BUDGETS, "high"), // 8 business hours
 * }, new Date("2026-03-02T15:00:00Z"))
 * status.level        // "warning" (6 of 8 hours used)
 * status.displayText  // "2h remaining"
 * ```
 */

import { type FieldIssue, ValidationError } from "@bib/shared/errors"
import { formatDuration } from "@bib/shared/format"
import { err, ok, type Result } from "@bib/shared/result"
import { hours } from "./clock.ts"
import type { Schedule } from "./schedule.ts"
import { isPaused, type SlaTimer, type TimerPause, timerDeadline, timerElapsed } from "./timer.ts"

/** Warning level, from least to most urgent. */
export type SlaLevel = "on_track" | "approaching" | "warning" | "critical" | "breached"

/** All levels in increasing urgency. */
export const SLA_LEVELS: readonly SlaLevel[] = [
  "on_track",
  "approaching",
  "warning",
  "critical",
  "breached",
]

/** Display labels for each level. */
export const SLA_LEVEL_LABELS: Readonly<Record<SlaLevel, string>> = {
  on_track: "On track",
  approaching: "Approaching",
  warning: "Warning",
  critical: "Critical",
  breached: "Breached",
}

/** Fractions of the budget (0..1, ascending) at which each warning level starts. */
export interface SlaThresholds {
  readonly approaching: number
  readonly warning: number
  readonly critical: number
}

/** 50% approaching, 75% warning, 90% critical. */
export const DEFAULT_THRESHOLDS: SlaThresholds = { approaching: 0.5, warning: 0.75, critical: 0.9 }

/** The four standard priority tiers. Any string union works with the helpers below. */
export type SlaPriority = "urgent" | "high" | "normal" | "low"

/** Business-time budgets per priority, in milliseconds. */
export type PriorityBudgets<P extends string = SlaPriority> = Readonly<Record<P, number>>

/** 4 / 8 / 24 / 72 business hours for urgent / high / normal / low. */
export const DEFAULT_PRIORITY_BUDGETS: PriorityBudgets = {
  urgent: hours(4),
  high: hours(8),
  normal: hours(24),
  low: hours(72),
}

/** The budget for `priority`. Throws `RangeError` for a priority the table does not have. */
export function budgetFor<P extends string>(
  budgets: PriorityBudgets<P>,
  priority: NoInfer<P>,
): number {
  const ms = Object.hasOwn(budgets, priority) ? budgets[priority] : undefined
  if (ms === undefined) throw new RangeError(`no budget for priority "${priority}"`)
  return ms
}

/** The level for a fraction of the budget used. */
export function levelFor(
  fraction: number,
  thresholds: SlaThresholds = DEFAULT_THRESHOLDS,
): SlaLevel {
  if (Number.isNaN(fraction)) throw new RangeError("fraction must be a number")
  if (fraction >= 1) return "breached"
  if (fraction >= thresholds.critical) return "critical"
  if (fraction >= thresholds.warning) return "warning"
  if (fraction >= thresholds.approaching) return "approaching"
  return "on_track"
}

/** What {@link evaluate} needs: a timer, or a start, budget and optional pauses. */
export type SlaInput =
  | SlaTimer
  | { readonly startedAt: Date; readonly budgetMs: number; readonly pauses?: readonly TimerPause[] }

/** Options for {@link evaluate}. */
export interface EvaluateOptions {
  readonly thresholds?: SlaThresholds
  /** Level from which {@link SlaStatus.atRisk} is true. Default `"warning"`. */
  readonly atRiskFrom?: SlaLevel
}

/** The state of one SLA at one instant. */
export interface SlaStatus {
  readonly level: SlaLevel
  /** Business time used / budget. Not capped: 1.5 means 50% over. A zero budget reads as 1. */
  readonly fraction: number
  /** Business time used, pauses excluded. */
  readonly elapsedMs: number
  /** Business time left; negative when overdue. */
  readonly remainingMs: number
  /** When the budget runs out; `null` while paused and not yet breached. */
  readonly deadline: Date | null
  readonly breached: boolean
  /** True at or above `atRiskFrom`, but not when breached. */
  readonly atRisk: boolean
  readonly paused: boolean
  /** `"2h 30m remaining"` or `"1h 15m overdue"` (business time). */
  readonly displayText: string
}

function isTimer(input: SlaInput): input is SlaTimer {
  return typeof input.startedAt === "number"
}

function toTimer(input: SlaInput): SlaTimer {
  if (isTimer(input)) return input
  const startedAt = input.startedAt
  if (!(startedAt instanceof Date) || Number.isNaN(startedAt.getTime())) {
    throw new RangeError("startedAt must be a valid Date")
  }
  if (!Number.isFinite(input.budgetMs) || input.budgetMs < 0) {
    throw new RangeError(`budgetMs must be a finite, non-negative number, got ${input.budgetMs}`)
  }
  return { startedAt: startedAt.getTime(), budgetMs: input.budgetMs, pauses: input.pauses ?? [] }
}

/** Evaluate one SLA at `now` (default: the current time). */
export function evaluate(
  schedule: Schedule,
  input: SlaInput,
  now: Date = new Date(),
  options: EvaluateOptions = {},
): SlaStatus {
  const timer = toTimer(input)
  const thresholds = options.thresholds ?? DEFAULT_THRESHOLDS
  const elapsedMs = timerElapsed(schedule, timer, now)
  const fraction = timer.budgetMs > 0 ? elapsedMs / timer.budgetMs : 1
  const level = levelFor(fraction, thresholds)
  const remainingMs = timer.budgetMs - elapsedMs
  const breached = level === "breached"
  const atRiskIndex = SLA_LEVELS.indexOf(options.atRiskFrom ?? "warning")
  return {
    level,
    fraction,
    elapsedMs,
    remainingMs,
    deadline: timerDeadline(schedule, timer),
    breached,
    atRisk: !breached && SLA_LEVELS.indexOf(level) >= atRiskIndex,
    paused: isPaused(timer),
    displayText: formatRemaining(remainingMs),
  }
}

/** Evaluate many SLAs against one shared `now`. Keys come from each item's `id`. */
export function evaluateMany<T extends { readonly id: string } & SlaInput>(
  schedule: Schedule,
  items: Iterable<T>,
  now: Date = new Date(),
  options: EvaluateOptions = {},
): Map<string, SlaStatus> {
  const out = new Map<string, SlaStatus>()
  for (const item of items) out.set(item.id, evaluate(schedule, item, now, options))
  return out
}

/** `"2h 30m remaining"`, `"1d 3h overdue"`, or `"0m remaining"`. Rounds down to the minute. */
export function formatRemaining(remainingMs: number): string {
  if (!Number.isFinite(remainingMs)) throw new RangeError("remainingMs must be finite")
  const abs = Math.floor(Math.abs(remainingMs) / 60_000) * 60_000
  const text = abs === 0 ? "0m" : formatDuration(abs)
  return remainingMs < 0 ? `${text} overdue` : `${text} remaining`
}

/** One escalation step. `notify` is whatever your app routes on: roles, channels, user ids. */
export interface EscalationTier {
  readonly name: string
  /** Fraction of the budget used at which this tier starts. */
  readonly atFraction: number
  readonly notify: readonly string[]
}

/** 50% / 75% / 90% / breached, widening the audience at each step. */
export const DEFAULT_ESCALATION_TIERS: readonly EscalationTier[] = [
  { name: "First warning", atFraction: 0.5, notify: ["assignee"] },
  { name: "Lead alert", atFraction: 0.75, notify: ["assignee", "team-lead"] },
  { name: "Critical", atFraction: 0.9, notify: ["assignee", "team-lead", "manager"] },
  { name: "Breached", atFraction: 1, notify: ["assignee", "team-lead", "manager", "admin"] },
]

/** The highest tier reached at `fraction`, or `undefined`. Tiers need not be sorted. */
export function escalationTier(
  fraction: number,
  tiers: readonly EscalationTier[] = DEFAULT_ESCALATION_TIERS,
): EscalationTier | undefined {
  let best: EscalationTier | undefined
  for (const tier of tiers) {
    if (fraction >= tier.atFraction && (best === undefined || tier.atFraction >= best.atFraction)) {
      best = tier
    }
  }
  return best
}

/** Check thresholds are numbers in (0, 1) with approaching < warning < critical. */
export function validateThresholds(
  thresholds: SlaThresholds,
): Result<SlaThresholds, ValidationError> {
  const issues: FieldIssue[] = []
  const keys = ["approaching", "warning", "critical"] as const
  for (const key of keys) {
    const v = thresholds?.[key]
    if (typeof v !== "number" || !(v > 0 && v < 1)) {
      issues.push({ path: key, message: "must be a number between 0 and 1 (exclusive)" })
    }
  }
  if (issues.length === 0) {
    if (thresholds.approaching >= thresholds.warning) {
      issues.push({ path: "warning", message: "must be greater than approaching" })
    }
    if (thresholds.warning >= thresholds.critical) {
      issues.push({ path: "critical", message: "must be greater than warning" })
    }
  }
  return issues.length > 0 ? err(new ValidationError("invalid thresholds", issues)) : ok(thresholds)
}

/** Check every budget is a finite, non-negative number of milliseconds. */
export function validatePriorityBudgets<P extends string>(
  budgets: PriorityBudgets<P>,
): Result<PriorityBudgets<P>, ValidationError> {
  const issues: FieldIssue[] = []
  if (typeof budgets !== "object" || budgets === null) {
    return err(new ValidationError("invalid budgets", [{ path: "", message: "must be an object" }]))
  }
  for (const [key, value] of Object.entries<number>(budgets)) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      issues.push({ path: key, message: "must be a finite, non-negative number of milliseconds" })
    }
  }
  return issues.length > 0 ? err(new ValidationError("invalid budgets", issues)) : ok(budgets)
}
