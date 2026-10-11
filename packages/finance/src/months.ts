import { z } from "zod"

/**
 * A month in the projection, written either as a 0-based index (`0` is the first
 * projected month) or as a calendar month `"YYYY-MM"`. Calendar months need
 * `meta.startMonth` so they can be turned into an index.
 */
export type MonthRef = number | string

const MONTH_KEY = /^(\d{4})-(0[1-9]|1[0-2])$/

/** Zod schema for a {@link MonthRef}. */
export const monthRefSchema = z.union([
  z.number().int().min(0),
  z.string().regex(MONTH_KEY, 'calendar months are written "YYYY-MM"'),
])

/** Zod schema for a `"YYYY-MM"` calendar month. */
export const monthKeySchema = z.string().regex(MONTH_KEY, 'calendar months are written "YYYY-MM"')

/** True when `text` is a `"YYYY-MM"` calendar month. */
export function isMonthKey(text: string): boolean {
  return MONTH_KEY.test(text)
}

function monthNumber(key: string): number {
  const match = MONTH_KEY.exec(key)
  if (match === null) throw new RangeError(`not a "YYYY-MM" month: ${key}`)
  return Number(match[1]) * 12 + (Number(match[2]) - 1)
}

/**
 * Turn a {@link MonthRef} into a 0-based projection index.
 *
 * ```ts
 * resolveMonth(3)                    // 3
 * resolveMonth("2027-03", "2027-01") // 2
 * ```
 *
 * Throws when a calendar month is given without `startMonth`, or falls before it.
 */
export function resolveMonth(ref: MonthRef, startMonth?: string): number {
  if (typeof ref === "number") {
    if (!Number.isInteger(ref) || ref < 0) throw new RangeError(`month index must be >= 0: ${ref}`)
    return ref
  }
  if (startMonth === undefined) {
    throw new RangeError(`calendar month ${ref} needs meta.startMonth to be set`)
  }
  const index = monthNumber(ref) - monthNumber(startMonth)
  if (index < 0) throw new RangeError(`month ${ref} is before meta.startMonth ${startMonth}`)
  return index
}

/**
 * Label for projection month `index`: the calendar month when `startMonth` is
 * known (`"2027-03"`), otherwise `"M1"`, `"M2"`, ... (1-based for people).
 */
export function monthLabel(index: number, startMonth?: string): string {
  if (startMonth === undefined) return `M${index + 1}`
  const n = monthNumber(startMonth) + index
  const year = Math.floor(n / 12)
  const month = (n % 12) + 1
  return `${year}-${String(month).padStart(2, "0")}`
}

/**
 * Calendar month (0 = January) of projection month `index`. Without
 * `startMonth` the projection is assumed to start in January.
 */
export function calendarMonthOf(index: number, startMonth?: string): number {
  const base = startMonth === undefined ? 0 : monthNumber(startMonth) % 12
  return (base + index) % 12
}
