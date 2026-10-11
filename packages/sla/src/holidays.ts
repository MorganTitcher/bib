/**
 * Rule-based public-holiday calendars. Rules describe *how* a holiday's date is
 * found, so a calendar works for any year without a yearly data refresh.
 *
 * Rule kinds:
 * - `fixed` — the same month and day every year (25 December);
 * - `nth-weekday` — the nth weekday of a month (third Monday of January);
 * - `last-weekday` — the last weekday of a month (last Monday of May);
 * - `easter` — a day offset from Western (Gregorian) Easter Sunday (Good Friday = -2);
 * - `date` — a one-off date (a royal funeral, a company shutdown day).
 *
 * Any rule may carry an `observed` policy that moves a holiday falling on a
 * weekend to a weekday, plus `fromYear` / `toYear` / `exceptYears` bounds.
 *
 * Observed policies:
 * - `"none"` (default) — the holiday stays on its date, weekend or not;
 * - `"nearest-weekday"` — Saturday → Friday, Sunday → Monday (US federal rule;
 *   a Saturday 1 January is observed on Friday 31 December of the year before);
 * - `"next-weekday"` — Saturday or Sunday → the next weekday that is not already
 *   a holiday (UK "substitute day": Christmas on Saturday → Monday 27th, Boxing
 *   Day on Sunday → Tuesday 28th);
 * - `"sunday-to-monday"` — only a Sunday holiday moves, to Monday.
 *
 * @example
 * ```ts
 * import { resolveHolidays, easterSunday } from "@bib/sla/holidays"
 *
 * easterSunday(2026) // "2026-04-05"
 * resolveHolidays([{ kind: "fixed", name: "Independence Day", month: 7, day: 4, observed: "nearest-weekday" }], 2026)
 * // [{ date: "2026-07-03", actualDate: "2026-07-04", name: "Independence Day", observed: true }]
 * ```
 */

import { daysInMonth, formatIsoDateParts, parseIsoDate } from "@bib/shared/dates"
import type { FieldIssue } from "@bib/shared/errors"
import { shiftIsoDate, weekdayOf } from "./zone.ts"

/** How a holiday that lands on a weekend is moved. */
export type ObservedPolicy = "none" | "nearest-weekday" | "next-weekday" | "sunday-to-monday"

interface RuleBase {
  /** Display name, e.g. `"Christmas Day"`. */
  readonly name: string
  /** Weekend shifting. Default `"none"`. */
  readonly observed?: ObservedPolicy
  /** First year the rule applies (inclusive). */
  readonly fromYear?: number
  /** Last year the rule applies (inclusive). */
  readonly toYear?: number
  /** Years in which the rule does not apply (a holiday moved by proclamation). */
  readonly exceptYears?: readonly number[]
}

/** Same month and day each year. `month` is 1-based. */
export interface FixedHolidayRule extends RuleBase {
  readonly kind: "fixed"
  readonly month: number
  readonly day: number
}

/** The `nth` (1-5) `weekday` (0 = Sunday … 6 = Saturday) of `month`. */
export interface NthWeekdayHolidayRule extends RuleBase {
  readonly kind: "nth-weekday"
  readonly month: number
  readonly weekday: number
  readonly nth: number
}

/** The last `weekday` of `month`. */
export interface LastWeekdayHolidayRule extends RuleBase {
  readonly kind: "last-weekday"
  readonly month: number
  readonly weekday: number
}

/** `offsetDays` from Western Easter Sunday (Good Friday -2, Easter Monday 1). */
export interface EasterHolidayRule extends RuleBase {
  readonly kind: "easter"
  readonly offsetDays: number
}

/** A one-off date. Year bounds are ignored; the date's own year is its year. */
export interface DateHolidayRule extends RuleBase {
  readonly kind: "date"
  readonly date: string
}

/** Any holiday rule. */
export type HolidayRule =
  | FixedHolidayRule
  | NthWeekdayHolidayRule
  | LastWeekdayHolidayRule
  | EasterHolidayRule
  | DateHolidayRule

/** One resolved holiday. `date` is the day the business is closed. */
export interface HolidayOccurrence {
  /** The closed day (`YYYY-MM-DD`), after any weekend shift. */
  readonly date: string
  /** The holiday's nominal date before shifting. */
  readonly actualDate: string
  readonly name: string
  /** True when `date` differs from `actualDate`. */
  readonly observed: boolean
}

/**
 * Western (Gregorian) Easter Sunday for `year`, as `YYYY-MM-DD`, using the
 * anonymous Gregorian algorithm (Meeus/Jones/Butcher).
 */
export function easterSunday(year: number): string {
  if (!Number.isInteger(year) || year < 1583) {
    throw new RangeError(`easterSunday() needs a Gregorian year >= 1583, got ${year}`)
  }
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return formatIsoDateParts(year, month, day)
}

/** The `nth` (1-5) occurrence of `weekday` in a month, or `undefined` if the month has no 5th. */
export function nthWeekdayOfMonth(
  year: number,
  month: number,
  weekday: number,
  nth: number,
): string | undefined {
  const firstDow = weekdayOf(formatIsoDateParts(year, month, 1))
  const day = 1 + ((weekday - firstDow + 7) % 7) + (nth - 1) * 7
  return day <= daysInMonth(year, month) ? formatIsoDateParts(year, month, day) : undefined
}

/** The last occurrence of `weekday` in a month. */
export function lastWeekdayOfMonth(year: number, month: number, weekday: number): string {
  const last = daysInMonth(year, month)
  const lastDow = weekdayOf(formatIsoDateParts(year, month, last))
  return formatIsoDateParts(year, month, last - ((lastDow - weekday + 7) % 7))
}

function appliesIn(rule: HolidayRule, year: number): boolean {
  if (rule.fromYear !== undefined && year < rule.fromYear) return false
  if (rule.toYear !== undefined && year > rule.toYear) return false
  return !(rule.exceptYears?.includes(year) ?? false)
}

/** The nominal date of `rule` in `year`, or `undefined` when it does not occur. */
export function nominalDate(rule: HolidayRule, year: number): string | undefined {
  if (rule.kind === "date") {
    const d = parseIsoDate(rule.date)
    return d && d.getUTCFullYear() === year ? rule.date : undefined
  }
  if (!appliesIn(rule, year)) return undefined
  switch (rule.kind) {
    case "fixed":
      return rule.day <= daysInMonth(year, rule.month)
        ? formatIsoDateParts(year, rule.month, rule.day)
        : undefined
    case "nth-weekday":
      return nthWeekdayOfMonth(year, rule.month, rule.weekday, rule.nth)
    case "last-weekday":
      return lastWeekdayOfMonth(year, rule.month, rule.weekday)
    case "easter":
      return shiftIsoDate(easterSunday(year), rule.offsetDays)
  }
}

/** Options for {@link resolveHolidays}. */
export interface ResolveHolidaysOptions {
  /** Days that count as weekend for observed shifting. Default Saturday and Sunday. */
  readonly weekendDays?: readonly number[]
}

/**
 * Every holiday whose **closed day** falls in `year`, sorted by date. Holidays
 * from neighbouring years whose observed day spills into `year` are included
 * (a Saturday 1 January observed on 31 December), and ones that spill out are
 * excluded. Substitute days never land on a date another holiday already
 * occupies.
 */
export function resolveHolidays(
  rules: readonly HolidayRule[],
  year: number,
  options: ResolveHolidaysOptions = {},
): HolidayOccurrence[] {
  if (!Number.isInteger(year)) throw new RangeError(`year must be an integer, got ${year}`)
  const weekend = new Set(options.weekendDays ?? [0, 6])
  const nominal: Array<{ rule: HolidayRule; date: string }> = []
  for (const y of [year - 1, year, year + 1]) {
    for (const rule of rules) {
      const date = nominalDate(rule, y)
      if (date !== undefined) nominal.push({ rule, date })
    }
  }
  nominal.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))

  // Pass 1: holidays that stay put claim their dates first, so a substitute
  // day can never displace a real holiday (UK Boxing Day on a Monday).
  const taken = new Set<string>()
  const staysPut = (entry: { rule: HolidayRule; date: string }): boolean =>
    (entry.rule.observed ?? "none") === "none" || !weekend.has(weekdayOf(entry.date))
  for (const entry of nominal) if (staysPut(entry)) taken.add(entry.date)

  const out: HolidayOccurrence[] = []
  for (const entry of nominal) {
    let date = entry.date
    if (!staysPut(entry)) {
      const dow = weekdayOf(date)
      switch (entry.rule.observed) {
        case "nearest-weekday":
          date = shiftIsoDate(date, dow === 6 ? -1 : 1)
          break
        case "sunday-to-monday":
          if (dow === 0) date = shiftIsoDate(date, 1)
          break
        case "next-weekday": {
          let guard = 0
          do {
            date = shiftIsoDate(date, 1)
            guard++
          } while ((weekend.has(weekdayOf(date)) || taken.has(date)) && guard < 14)
          break
        }
        default:
          break
      }
      taken.add(date)
    }
    if (date.startsWith(`${String(year).padStart(4, "0")}-`)) {
      out.push({
        date,
        actualDate: entry.date,
        name: entry.rule.name,
        observed: date !== entry.date,
      })
    }
  }
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  return out
}

const OBSERVED: readonly ObservedPolicy[] = [
  "none",
  "nearest-weekday",
  "next-weekday",
  "sunday-to-monday",
]

function isIntIn(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max
}

/** Every problem with a list of rules (empty when all are valid). `path` is prefixed with `prefix`. */
export function validateHolidayRules(
  rules: readonly HolidayRule[],
  prefix = "holidays",
): FieldIssue[] {
  const issues: FieldIssue[] = []
  if (!Array.isArray(rules)) return [{ path: prefix, message: "must be an array of rules" }]
  rules.forEach((rule, i) => {
    const at = (field: string): string => `${prefix}[${i}]${field ? `.${field}` : ""}`
    const add = (field: string, message: string): void => {
      issues.push({ path: at(field), message })
    }
    if (typeof rule !== "object" || rule === null) {
      add("", "must be an object")
      return
    }
    if (typeof rule.name !== "string" || rule.name.trim() === "") add("name", "must be non-empty")
    if (rule.observed !== undefined && !OBSERVED.includes(rule.observed)) {
      add("observed", `must be one of ${OBSERVED.join(", ")}`)
    }
    if (rule.fromYear !== undefined && !Number.isInteger(rule.fromYear))
      add("fromYear", "must be an integer")
    if (rule.toYear !== undefined && !Number.isInteger(rule.toYear))
      add("toYear", "must be an integer")
    if (rule.fromYear !== undefined && rule.toYear !== undefined && rule.fromYear > rule.toYear) {
      add("toYear", "must not be before fromYear")
    }
    switch (rule.kind) {
      case "fixed":
        if (!isIntIn(rule.month, 1, 12)) add("month", "must be an integer 1..12")
        else if (!isIntIn(rule.day, 1, daysInMonth(2024, rule.month)))
          add("day", "is not a day of that month")
        break
      case "nth-weekday":
        if (!isIntIn(rule.month, 1, 12)) add("month", "must be an integer 1..12")
        if (!isIntIn(rule.weekday, 0, 6)) add("weekday", "must be an integer 0..6 (0 = Sunday)")
        if (!isIntIn(rule.nth, 1, 5)) add("nth", "must be an integer 1..5")
        break
      case "last-weekday":
        if (!isIntIn(rule.month, 1, 12)) add("month", "must be an integer 1..12")
        if (!isIntIn(rule.weekday, 0, 6)) add("weekday", "must be an integer 0..6 (0 = Sunday)")
        break
      case "easter":
        if (!isIntIn(rule.offsetDays, -366, 366)) add("offsetDays", "must be an integer")
        break
      case "date":
        if (typeof rule.date !== "string" || !parseIsoDate(rule.date))
          add("date", "must be a real YYYY-MM-DD date")
        break
      default:
        add("kind", "must be fixed, nth-weekday, last-weekday, easter or date")
    }
  })
  return issues
}

/** Convenience: `HolidayRule` objects for one-off closure dates. */
export function oneOffDates(
  entries: ReadonlyArray<{ date: string; name: string }>,
): DateHolidayRule[] {
  return entries.map((e) => ({ kind: "date", date: e.date, name: e.name }))
}
