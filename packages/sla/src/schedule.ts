/**
 * A business-hours schedule: an IANA time zone, opening hours per weekday (any
 * number of shifts per day, including overnight shifts), a holiday calendar,
 * extra closure days, and per-date overrides for special hours.
 *
 * For any calendar date the opening hours come from, in priority order:
 * 1. a `dateOverrides` entry for that date (special hours; `[]` means closed);
 * 2. a `closures` entry (closed);
 * 3. a holiday from `holidays` whose closed day is that date (closed);
 * 4. the `weekly` hours for that weekday.
 *
 * A shift whose `end` is not after its `start` runs overnight and belongs to
 * the day it **starts** on: `{ start: "22:00", end: "06:00" }` on Friday ends at
 * 06:00 on Saturday, even if Saturday is a holiday. `"24:00"` is a valid end.
 *
 * @example
 * ```ts
 * import { createSchedule, weekdayHours } from "@bib/sla/schedule"
 * import { US_FEDERAL_HOLIDAYS } from "@bib/sla/calendars"
 *
 * const result = createSchedule({
 *   timeZone: "America/New_York",
 *   weekly: weekdayHours("09:00", "17:00"),
 *   holidays: US_FEDERAL_HOLIDAYS,
 *   closures: [{ date: "2026-12-24", name: "Office closed" }],
 * })
 * if (!result.ok) throw result.error // ValidationError listing every issue
 * const schedule = result.value
 * schedule.isBusinessDay("2026-07-03") // false (Independence Day observed)
 * schedule.nextBusinessDay("2026-07-02") // "2026-07-06"
 * ```
 */

import { parseIsoDate } from "@bib/shared/dates"
import { type FieldIssue, ValidationError } from "@bib/shared/errors"
import { err, ok, type Result } from "@bib/shared/result"
import {
  type HolidayOccurrence,
  type HolidayRule,
  resolveHolidays,
  validateHolidayRules,
} from "./holidays.ts"
import {
  isValidTimeZone,
  localDateOf,
  parseWallTime,
  shiftIsoDate,
  wallTimeToInstant,
  weekdayOf,
} from "./zone.ts"

/** One block of opening hours, as 24-hour `HH:MM` local wall times. */
export interface Shift {
  readonly start: string
  /** End time. `"24:00"` means midnight at the end of the day; an end at or before `start` means overnight. */
  readonly end: string
}

/** Lowercase three-letter weekday keys. */
export type WeekdayKey = "sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat"

/** Weekday keys in `Date#getUTCDay()` order (index 0 = Sunday). */
export const WEEKDAY_KEYS: readonly WeekdayKey[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"]

/** Opening hours per weekday. A missing or empty day is closed. */
export type WeeklyHours = Readonly<Partial<Record<WeekdayKey, readonly Shift[]>>>

/** An extra closed day. A bare string is a `YYYY-MM-DD` date. */
export type Closure = string | { readonly date: string; readonly name?: string }

/** Special hours for one date. `shifts: []` closes the day. */
export interface DateOverride {
  readonly date: string
  readonly shifts: readonly Shift[]
  readonly name?: string
}

/** Everything {@link createSchedule} needs. */
export interface ScheduleConfig {
  /** IANA zone the wall times are in, e.g. `"Europe/London"` or `"UTC"`. */
  readonly timeZone: string
  readonly weekly: WeeklyHours
  /** Holiday rules, e.g. {@link US_FEDERAL_HOLIDAYS}. */
  readonly holidays?: readonly HolidayRule[]
  readonly closures?: readonly Closure[]
  readonly dateOverrides?: readonly DateOverride[]
  /**
   * Weekdays (0 = Sunday) that count as the weekend when a holiday's observed
   * day is moved. Default Saturday and Sunday. This does not change opening
   * hours; `weekly` does that.
   */
  readonly observedWeekendDays?: readonly number[]
}

/** A half-open span of business time `[start, end)`. */
export interface BusinessInterval {
  readonly start: Date
  readonly end: Date
}

/** Why a date has the hours it has. */
export type DayKind = "regular" | "override" | "closure" | "holiday" | "closed"

/** What a schedule says about one calendar date. */
export interface DayInfo {
  readonly date: string
  readonly kind: DayKind
  /** True when the day owns at least one shift. */
  readonly open: boolean
  /** Holiday, closure or override name, when there is one. */
  readonly name?: string
  readonly shifts: readonly Shift[]
}

/** A date argument: a `YYYY-MM-DD` string, or a `Date` read in the schedule's zone. */
export type DateInput = string | Date

interface ParsedShift {
  readonly start: number
  readonly end: number
  readonly overnight: boolean
}

const MAX_CACHED_DAYS = 4096
/** Longest run of closed days the day-stepping helpers tolerate before giving up. */
export const MAX_CLOSED_DAY_RUN = 3700

/**
 * Monday-to-Friday (or any `days`) hours with one shift a day. `days` are
 * weekday numbers, 0 = Sunday.
 *
 * @example
 * ```ts
 * weekdayHours("08:00", "17:00")                // Mon-Fri 08:00-17:00
 * weekdayHours("10:00", "16:00", [6])           // Saturdays only
 * ```
 */
export function weekdayHours(
  start: string,
  end: string,
  days: readonly number[] = [1, 2, 3, 4, 5],
): WeeklyHours {
  const out: Partial<Record<WeekdayKey, readonly Shift[]>> = {}
  for (const d of days) {
    const key = WEEKDAY_KEYS[d]
    if (key === undefined) throw new RangeError(`weekday must be 0..6, got ${d}`)
    out[key] = [{ start, end }]
  }
  return out
}

function parseShifts(shifts: readonly Shift[], path: string, issues: FieldIssue[]): ParsedShift[] {
  if (!Array.isArray(shifts)) {
    issues.push({ path, message: "must be an array of shifts" })
    return []
  }
  const parsed: ParsedShift[] = []
  shifts.forEach((shift, i) => {
    const at = `${path}[${i}]`
    if (typeof shift !== "object" || shift === null) {
      issues.push({ path: at, message: "must be { start, end }" })
      return
    }
    const start = typeof shift.start === "string" ? parseWallTime(shift.start) : undefined
    const end = typeof shift.end === "string" ? parseWallTime(shift.end) : undefined
    if (start === undefined || start === 1440) {
      issues.push({ path: `${at}.start`, message: "must be HH:MM between 00:00 and 23:59" })
    }
    if (end === undefined)
      issues.push({ path: `${at}.end`, message: "must be HH:MM (24:00 allowed)" })
    if (start === undefined || start === 1440 || end === undefined) return
    if (start === end) {
      issues.push({ path: at, message: "start and end are equal; use 00:00-24:00 for all day" })
      return
    }
    const overnight = end < start
    parsed.push({ start, end: overnight ? end + 1440 : end, overnight })
  })
  const sorted = [...parsed].sort((a, b) => a.start - b.start)
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]
    const cur = sorted[i]
    if (prev !== undefined && cur !== undefined && cur.start < prev.end) {
      issues.push({ path, message: "shifts overlap" })
      break
    }
  }
  return sorted
}

function isDate(text: unknown): text is string {
  return typeof text === "string" && parseIsoDate(text) !== undefined
}

/**
 * A validated, immutable business-hours schedule. Create one with
 * {@link createSchedule} or {@link defineSchedule}. Results are cached per date
 * and per year, so reusing one schedule is cheap.
 */
export class Schedule {
  readonly timeZone: string
  readonly config: ScheduleConfig
  readonly #weekly: ReadonlyArray<readonly ParsedShift[]>
  readonly #weeklyRaw: ReadonlyArray<readonly Shift[]>
  readonly #closures: ReadonlyMap<string, string | undefined>
  readonly #overrides: ReadonlyMap<string, { parsed: ParsedShift[]; raw: DateOverride }>
  readonly #rules: readonly HolidayRule[]
  readonly #weekend: readonly number[]
  readonly #holidayYears = new Map<number, ReadonlyMap<string, HolidayOccurrence>>()
  readonly #intervals = new Map<string, readonly BusinessInterval[]>()

  /** @internal Use {@link createSchedule}; the constructor trusts its input. */
  constructor(
    config: ScheduleConfig,
    weekly: ReadonlyArray<readonly ParsedShift[]>,
    overrides: ReadonlyMap<string, { parsed: ParsedShift[]; raw: DateOverride }>,
  ) {
    this.config = config
    this.timeZone = config.timeZone
    this.#weekly = weekly
    this.#weeklyRaw = WEEKDAY_KEYS.map((k) => config.weekly[k] ?? [])
    this.#overrides = overrides
    this.#rules = config.holidays ?? []
    this.#weekend = config.observedWeekendDays ?? [0, 6]
    const closures = new Map<string, string | undefined>()
    for (const c of config.closures ?? []) {
      if (typeof c === "string") closures.set(c, undefined)
      else closures.set(c.date, c.name)
    }
    this.#closures = closures
  }

  /** Resolved holidays whose closed day falls in `year`, sorted by date. */
  holidaysIn(year: number): HolidayOccurrence[] {
    return [...this.#holidayMap(year).values()]
  }

  /** The holiday closing `date`, if any. */
  holidayOn(date: DateInput): HolidayOccurrence | undefined {
    const iso = this.#iso(date)
    return this.#holidayMap(Number(iso.slice(0, 4))).get(iso)
  }

  /** Why `date` has the hours it has, and which shifts it owns. */
  dayInfo(date: DateInput): DayInfo {
    const iso = this.#iso(date)
    const override = this.#overrides.get(iso)
    if (override) {
      const base = { date: iso, kind: "override" as const, open: override.parsed.length > 0 }
      return {
        ...base,
        shifts: override.raw.shifts,
        ...(override.raw.name !== undefined ? { name: override.raw.name } : {}),
      }
    }
    if (this.#closures.has(iso)) {
      const name = this.#closures.get(iso)
      return {
        date: iso,
        kind: "closure",
        open: false,
        shifts: [],
        ...(name !== undefined ? { name } : {}),
      }
    }
    const holiday = this.holidayOn(iso)
    if (holiday) return { date: iso, kind: "holiday", open: false, name: holiday.name, shifts: [] }
    const raw = this.#weeklyRaw[weekdayOf(iso)] ?? []
    return {
      date: iso,
      kind: raw.length > 0 ? "regular" : "closed",
      open: raw.length > 0,
      shifts: raw,
    }
  }

  /**
   * The business intervals owned by `date`, as UTC instants in start order.
   * An overnight shift's interval ends on the following day. Wall times that
   * fall in a DST gap move forward; ambiguous ones take the earlier instant.
   */
  intervalsOn(date: DateInput): readonly BusinessInterval[] {
    const iso = this.#iso(date)
    const cached = this.#intervals.get(iso)
    if (cached) return cached
    const shifts = this.#shiftsFor(iso)
    const out: BusinessInterval[] = []
    for (const s of shifts) {
      const start = wallTimeToInstant(iso, s.start, this.timeZone)
      const end =
        s.end > 1440
          ? wallTimeToInstant(shiftIsoDate(iso, 1), s.end - 1440, this.timeZone)
          : wallTimeToInstant(iso, s.end, this.timeZone)
      if (end.getTime() > start.getTime()) out.push({ start, end })
    }
    if (this.#intervals.size >= MAX_CACHED_DAYS) this.#intervals.clear()
    const frozen = Object.freeze(out)
    this.#intervals.set(iso, frozen)
    return frozen
  }

  /** True when `date` owns at least one shift. */
  isBusinessDay(date: DateInput): boolean {
    return this.#shiftsFor(this.#iso(date)).length > 0
  }

  /** The first business day strictly after `date`. */
  nextBusinessDay(date: DateInput): string {
    return this.#step(this.#iso(date), 1)
  }

  /** The last business day strictly before `date`. */
  previousBusinessDay(date: DateInput): string {
    return this.#step(this.#iso(date), -1)
  }

  /**
   * Business days in `[from, to)`: `from` counts, `to` does not. Negative when
   * `to` is before `from`.
   */
  countBusinessDays(from: DateInput, to: DateInput): number {
    const a = this.#iso(from)
    const b = this.#iso(to)
    if (a === b) return 0
    if (b < a) return -this.countBusinessDays(b, a)
    let count = 0
    for (let d = a; d < b; d = shiftIsoDate(d, 1)) if (this.isBusinessDay(d)) count++
    return count
  }

  /**
   * The date `days` business days after `date` (before it when negative).
   * `date` itself need not be a business day; `0` returns it unchanged.
   */
  addBusinessDays(date: DateInput, days: number): string {
    if (!Number.isInteger(days)) throw new RangeError(`days must be an integer, got ${days}`)
    let d = this.#iso(date)
    const dir = days < 0 ? -1 : 1
    for (let left = Math.abs(days); left > 0; left--) d = this.#step(d, dir)
    return d
  }

  #step(iso: string, dir: 1 | -1): string {
    let d = iso
    for (let i = 0; i < MAX_CLOSED_DAY_RUN; i++) {
      d = shiftIsoDate(d, dir)
      if (this.isBusinessDay(d)) return d
    }
    throw new RangeError(`no business day within ${MAX_CLOSED_DAY_RUN} days of ${iso}`)
  }

  #shiftsFor(iso: string): readonly ParsedShift[] {
    const override = this.#overrides.get(iso)
    if (override) return override.parsed
    if (this.#closures.has(iso)) return []
    if (this.holidayOn(iso)) return []
    return this.#weekly[weekdayOf(iso)] ?? []
  }

  #holidayMap(year: number): ReadonlyMap<string, HolidayOccurrence> {
    let map = this.#holidayYears.get(year)
    if (!map) {
      const m = new Map<string, HolidayOccurrence>()
      if (this.#rules.length > 0) {
        for (const h of resolveHolidays(this.#rules, year, { weekendDays: this.#weekend })) {
          if (!m.has(h.date)) m.set(h.date, h)
        }
      }
      map = m
      this.#holidayYears.set(year, map)
    }
    return map
  }

  #iso(date: DateInput): string {
    if (date instanceof Date) return localDateOf(date, this.timeZone)
    if (!isDate(date))
      throw new RangeError(`expected a YYYY-MM-DD date or a Date, got ${String(date)}`)
    return date
  }
}

/**
 * Validate `config` and build a {@link Schedule}. Every problem is reported at
 * once as a `ValidationError` whose `issues` carry field paths
 * (`"weekly.mon[0].end"`, `"holidays[3].month"`).
 */
export function createSchedule(config: ScheduleConfig): Result<Schedule, ValidationError> {
  const issues: FieldIssue[] = []
  if (typeof config !== "object" || config === null) {
    return err(
      new ValidationError("invalid schedule", [{ path: "", message: "must be an object" }]),
    )
  }
  if (!isValidTimeZone(config.timeZone)) {
    issues.push({ path: "timeZone", message: "must be an IANA time zone this runtime recognises" })
  }
  const weekly: ParsedShift[][] = []
  if (typeof config.weekly !== "object" || config.weekly === null) {
    issues.push({ path: "weekly", message: "must be an object keyed by weekday" })
  } else {
    for (const key of Object.keys(config.weekly)) {
      if (!WEEKDAY_KEYS.includes(key as WeekdayKey)) {
        issues.push({ path: `weekly.${key}`, message: "is not a weekday key (sun..sat)" })
      }
    }
    for (const key of WEEKDAY_KEYS) {
      const shifts = config.weekly[key]
      weekly.push(shifts === undefined ? [] : parseShifts(shifts, `weekly.${key}`, issues))
    }
  }
  const overrides = new Map<string, { parsed: ParsedShift[]; raw: DateOverride }>()
  ;(config.dateOverrides ?? []).forEach((o, i) => {
    const at = `dateOverrides[${i}]`
    if (!isDate(o?.date)) {
      issues.push({ path: `${at}.date`, message: "must be a real YYYY-MM-DD date" })
      return
    }
    if (overrides.has(o.date)) issues.push({ path: `${at}.date`, message: "duplicate date" })
    overrides.set(o.date, { parsed: parseShifts(o.shifts, `${at}.shifts`, issues), raw: o })
  })
  const suppliedShifts =
    typeof config.weekly === "object" && config.weekly !== null
      ? WEEKDAY_KEYS.reduce((n, k) => n + (config.weekly[k]?.length ?? 0), 0)
      : -1
  if (suppliedShifts === 0) {
    issues.push({ path: "weekly", message: "needs at least one shift in the week" })
  }
  ;(config.closures ?? []).forEach((c, i) => {
    const date = typeof c === "string" ? c : c?.date
    if (!isDate(date))
      issues.push({ path: `closures[${i}]`, message: "must be a real YYYY-MM-DD date" })
  })
  if (config.holidays !== undefined) issues.push(...validateHolidayRules(config.holidays))
  if (config.observedWeekendDays !== undefined) {
    const bad =
      !Array.isArray(config.observedWeekendDays) ||
      config.observedWeekendDays.some((d) => !Number.isInteger(d) || d < 0 || d > 6)
    if (bad) issues.push({ path: "observedWeekendDays", message: "must be weekday numbers 0..6" })
  }
  if (issues.length > 0) return err(new ValidationError("invalid schedule", issues))
  return ok(new Schedule(config, weekly, overrides))
}

/** Like {@link createSchedule} but throws the `ValidationError`. For static configuration. */
export function defineSchedule(config: ScheduleConfig): Schedule {
  const result = createSchedule(config)
  if (!result.ok) throw result.error
  return result.value
}
