/**
 * Calendar-date utilities. All arithmetic here is done in **UTC** so results do
 * not depend on the server's timezone or shift across daylight-saving
 * transitions. A "calendar date" is represented as a `Date` at UTC midnight.
 * Use {@link zonedParts} when you need wall-clock fields in a specific
 * IANA timezone (for display, or for "what day is it for this customer?").
 *
 * @example
 * ```ts
 * import { parseIsoDate, addMonthsClamped, monthsBetween, isoMonthKey, zonedParts } from "@bib/shared/dates"
 *
 * const jan31 = parseIsoDate("2026-01-31")          // Date 2026-01-31T00:00:00Z
 * addMonthsClamped(jan31!, 1)                        // 2026-02-28 (clamped, not Mar 3)
 * monthsBetween(parseIsoDate("2026-01-15")!, parseIsoDate("2026-04-14")!) // 2
 * isoMonthKey(new Date("2026-07-04T12:00:00Z"))      // "2026-07"
 * zonedParts(new Date("2026-03-01T03:30:00Z"), "America/New_York")
 * // { year: 2026, month: 2, day: 28, hour: 22, minute: 30, second: 0, weekday: 6 }
 * ```
 */

/** Milliseconds per unit. */
export const MS_PER_SECOND = 1_000
export const MS_PER_MINUTE = 60_000
export const MS_PER_HOUR = 3_600_000
export const MS_PER_DAY = 86_400_000

function utcDate(year: number, monthIndex: number, day: number): Date {
  const d = new Date(0)
  d.setUTCFullYear(year, monthIndex, day)
  d.setUTCHours(0, 0, 0, 0)
  return d
}

function assertValid(date: Date, fn: string): void {
  if (Number.isNaN(date.getTime())) throw new RangeError(`${fn}() received an invalid Date`)
}

/** True when `year` is a Gregorian leap year. */
export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

/**
 * Days in a month. `month` is **1-based** (1 = January).
 *
 * @example
 * ```ts
 * daysInMonth(2024, 2) // 29
 * daysInMonth(2026, 2) // 28
 * ```
 */
export function daysInMonth(year: number, month: number): number {
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError(`month must be 1..12, got ${month}`)
  }
  return utcDate(year, month, 0).getUTCDate()
}

/**
 * Strictly parse `YYYY-MM-DD` into a UTC-midnight Date. Returns `undefined` for
 * any other shape or an impossible date (`2026-02-30`). Unlike `new Date(str)`,
 * this never interprets the string in local time and never rolls over.
 */
export function parseIsoDate(text: string): Date | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  if (!m) return undefined
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return undefined
  return utcDate(year, month - 1, day)
}

/** Format the UTC calendar date as `YYYY-MM-DD`. */
export function formatIsoDate(date: Date): string {
  assertValid(date, "formatIsoDate")
  return date.toISOString().slice(0, 10)
}

/**
 * Format calendar fields (`month` 1-based) as zero-padded `YYYY-MM-DD` without
 * building a Date, so years 0–99 are not remapped to 1900–1999. Pairs with
 * {@link zonedParts} to name a day in a timezone.
 *
 * @throws RangeError when a field is not an integer in range.
 */
export function formatIsoDateParts(year: number, month: number, day: number): string {
  if (!Number.isInteger(year) || year < 0 || year > 9999) {
    throw new RangeError(`formatIsoDateParts: year must be an integer in 0..9999, got ${year}`)
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError(`formatIsoDateParts: month must be an integer in 1..12, got ${month}`)
  }
  if (!Number.isInteger(day) || day < 1 || day > daysInMonth(year, month)) {
    throw new RangeError(`formatIsoDateParts: invalid day ${day} for ${year}-${month}`)
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

/** Add whole days (negative to subtract). Exactly `n × 24h` — no DST effects in UTC. */
export function addDays(date: Date, days: number): Date {
  assertValid(date, "addDays")
  if (!Number.isInteger(days)) throw new RangeError(`days must be an integer, got ${days}`)
  return new Date(date.getTime() + days * MS_PER_DAY)
}

/**
 * Add calendar months, clamping the day to the target month's length, and
 * preserving the UTC time of day. This is the billing-cycle rule: a
 * subscription that renews on the 31st renews on Feb 28/29.
 *
 * @example
 * ```ts
 * addMonthsClamped(parseIsoDate("2024-01-31")!, 1)  // 2024-02-29
 * addMonthsClamped(parseIsoDate("2026-03-31")!, -1) // 2026-02-28
 * ```
 */
export function addMonthsClamped(date: Date, months: number): Date {
  assertValid(date, "addMonthsClamped")
  if (!Number.isInteger(months)) throw new RangeError(`months must be an integer, got ${months}`)
  const total = date.getUTCFullYear() * 12 + date.getUTCMonth() + months
  const year = Math.floor(total / 12)
  const monthIndex = total - year * 12
  const day = Math.min(date.getUTCDate(), daysInMonth(year, monthIndex + 1))
  const out = utcDate(year, monthIndex, day)
  out.setUTCHours(
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
    date.getUTCMilliseconds(),
  )
  return out
}

/**
 * Whole calendar months from `from` to `to` (negative if `to` is earlier). A
 * month counts only once its day-of-month (and time) is reached:
 * Jan 15 → Feb 14 is 0, Jan 15 → Feb 15 is 1. Month-end clamping matches
 * {@link addMonthsClamped}, so Jan 31 → Feb 28 (non-leap) is 1.
 */
export function monthsBetween(from: Date, to: Date): number {
  assertValid(from, "monthsBetween")
  assertValid(to, "monthsBetween")
  if (to.getTime() < from.getTime()) return -monthsBetween(to, from)
  let months =
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth())
  if (addMonthsClamped(from, months).getTime() > to.getTime()) months--
  return months
}

/** Whole UTC calendar days from `from` to `to` (time of day ignored). */
export function daysBetween(from: Date, to: Date): number {
  assertValid(from, "daysBetween")
  assertValid(to, "daysBetween")
  const a = utcDate(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()).getTime()
  const b = utcDate(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()).getTime()
  return Math.round((b - a) / MS_PER_DAY)
}

/** First day of the date's UTC month, at midnight. */
export function startOfMonth(date: Date): Date {
  assertValid(date, "startOfMonth")
  return utcDate(date.getUTCFullYear(), date.getUTCMonth(), 1)
}

/** `YYYY-MM` for the date's UTC month — a sortable grouping key. */
export function isoMonthKey(date: Date): string {
  assertValid(date, "isoMonthKey")
  return date.toISOString().slice(0, 7)
}

/** Wall-clock fields in a timezone. `month` is 1-based; `weekday` is 0 = Sunday … 6 = Saturday. */
export interface ZonedParts {
  readonly year: number
  readonly month: number
  readonly day: number
  readonly hour: number
  readonly minute: number
  readonly second: number
  readonly weekday: number
}

const WEEKDAYS: Readonly<Record<string, number>> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
}

const zonedFormatters = new Map<string, Intl.DateTimeFormat>()

/**
 * The wall-clock date and time of `date` in IANA timezone `timeZone`, via
 * `Intl.DateTimeFormat`. Throws `RangeError` for an unknown timezone.
 */
export function zonedParts(date: Date, timeZone: string): ZonedParts {
  assertValid(date, "zonedParts")
  let fmt = zonedFormatters.get(timeZone)
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      weekday: "short",
    })
    zonedFormatters.set(timeZone, fmt)
  }
  const fields: Record<string, string> = {}
  for (const part of fmt.formatToParts(date)) fields[part.type] = part.value
  const num = (key: string): number => Number(fields[key] ?? Number.NaN)
  return {
    year: num("year"),
    month: num("month"),
    day: num("day"),
    hour: num("hour"),
    minute: num("minute"),
    second: num("second"),
    weekday: WEEKDAYS[fields.weekday ?? ""] ?? Number.NaN,
  }
}
