/**
 * Time-zone primitives built on `Intl` only: parse `HH:MM` wall times, find the
 * local calendar date of an instant, and convert a wall-clock time in an IANA
 * zone back to a UTC instant with explicit daylight-saving rules.
 *
 * DST policy (the same as Temporal's `"compatible"` disambiguation):
 * - a wall time that does not exist (spring-forward gap) moves **forward** by
 *   the length of the gap: 02:30 on a New York spring-forward day is 03:30 EDT;
 * - a wall time that happens twice (fall-back overlap) resolves to the
 *   **earlier** instant: 01:30 on a New York fall-back day is 01:30 EDT.
 *
 * @example
 * ```ts
 * import { parseWallTime, wallTimeToInstant, localDateOf } from "@bib/sla/zone"
 *
 * parseWallTime("17:30")                                   // 1050 (minutes after midnight)
 * wallTimeToInstant("2026-03-08", 150, "America/New_York")  // 2026-03-08T07:30:00.000Z (gap → 03:30 EDT)
 * localDateOf(new Date("2026-01-01T03:00:00Z"), "America/Los_Angeles") // "2025-12-31"
 * ```
 */

import { addDays, formatIsoDate, MS_PER_MINUTE, parseIsoDate, zonedParts } from "@bib/shared/dates"

/** Minutes in a day; also the only legal `HH:MM` value above 23:59 (`"24:00"`). */
export const MINUTES_PER_DAY = 1440

const TIME_RE = /^(\d{2}):(\d{2})$/

/**
 * Parse a strict 24-hour `HH:MM` string into minutes after midnight. `"24:00"`
 * is accepted (it means end of day) and returns 1440. Returns `undefined` for
 * anything else (`"9:00"`, `"24:01"`, `"12:60"`).
 */
export function parseWallTime(text: string): number | undefined {
  const m = TIME_RE.exec(text)
  if (!m) return undefined
  const h = Number(m[1])
  const min = Number(m[2])
  if (min > 59) return undefined
  if (h === 24 && min === 0) return MINUTES_PER_DAY
  if (h > 23) return undefined
  return h * 60 + min
}

/** True when `timeZone` is an IANA zone (or `"UTC"`) this runtime's `Intl` recognises. */
export function isValidTimeZone(timeZone: string): boolean {
  if (typeof timeZone !== "string" || timeZone.length === 0) return false
  try {
    new Intl.DateTimeFormat("en-US", { timeZone })
    return true
  } catch {
    return false
  }
}

function assertInstant(date: Date, fn: string): void {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new RangeError(`${fn}() received an invalid Date`)
  }
}

/** UTC offset of `timeZone` at instant `ms`, in milliseconds (positive east of Greenwich). */
export function offsetAt(ms: number, timeZone: string): number {
  const p = zonedParts(new Date(ms), timeZone)
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return wall - Math.floor(ms / 1000) * 1000
}

/** The calendar date (`YYYY-MM-DD`) that `date` falls on in `timeZone`. */
export function localDateOf(date: Date, timeZone: string): string {
  assertInstant(date, "localDateOf")
  const p = zonedParts(date, timeZone)
  return `${String(p.year).padStart(4, "0")}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`
}

/** Minutes after local midnight of `date` in `timeZone` (seconds dropped). */
export function localMinuteOf(date: Date, timeZone: string): number {
  assertInstant(date, "localMinuteOf")
  const p = zonedParts(date, timeZone)
  return p.hour * 60 + p.minute
}

/** Shift a `YYYY-MM-DD` date by whole days. Throws on a malformed date. */
export function shiftIsoDate(isoDate: string, days: number): string {
  const d = parseIsoDate(isoDate)
  if (!d) throw new RangeError(`not a valid YYYY-MM-DD date: ${isoDate}`)
  return formatIsoDate(addDays(d, days))
}

/** Day of week (0 = Sunday … 6 = Saturday) of a `YYYY-MM-DD` date. */
export function weekdayOf(isoDate: string): number {
  const d = parseIsoDate(isoDate)
  if (!d) throw new RangeError(`not a valid YYYY-MM-DD date: ${isoDate}`)
  return d.getUTCDay()
}

/**
 * The UTC instant at which the wall clock in `timeZone` reads `minutes` after
 * midnight on `isoDate`. `minutes` may be 0..1440 (1440 is the next day's
 * midnight). Gaps resolve forward and overlaps resolve to the earlier instant
 * (see the module comment).
 */
export function wallTimeToInstant(isoDate: string, minutes: number, timeZone: string): Date {
  const d = parseIsoDate(isoDate)
  if (!d) throw new RangeError(`not a valid YYYY-MM-DD date: ${isoDate}`)
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > MINUTES_PER_DAY) {
    throw new RangeError(`minutes must be an integer 0..1440, got ${minutes}`)
  }
  const wall = d.getTime() + minutes * MS_PER_MINUTE
  // Offsets a day either side bracket any single transition near this wall time.
  const before = offsetAt(wall - 86_400_000, timeZone)
  const after = offsetAt(wall + 86_400_000, timeZone)
  const candidates: number[] = []
  for (const offset of before === after ? [before] : [before, after]) {
    const t = wall - offset
    if (t + offsetAt(t, timeZone) === wall) candidates.push(t)
  }
  if (candidates.length > 0) return new Date(Math.min(...candidates))
  // Nonexistent wall time: interpret with the pre-transition offset, which
  // lands the same distance past the gap.
  return new Date(wall - before)
}
