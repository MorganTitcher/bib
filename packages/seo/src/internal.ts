/** Internal helpers shared across modules. Not exported from the package. */
import { parseIsoDate } from "@bib/shared/dates"

/** Drop keys whose value is `undefined` (and empty arrays when `dropEmptyArrays`). */
export function compact<T extends Record<string, unknown>>(
  value: T,
  dropEmptyArrays = true,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, v] of Object.entries(value)) {
    if (v === undefined) continue
    if (dropEmptyArrays && Array.isArray(v) && v.length === 0) continue
    out[key] = v
  }
  return out
}

export type DateInput = string | Date

const BARE_DAY = /^\d{4}-\d{2}-\d{2}$/

/**
 * Normalize a date input. A bare `YYYY-MM-DD` stays a bare day (it is a valid
 * W3C datetime and schema.org Date); anything else becomes a full ISO instant.
 * Returns `undefined` for an unparseable or impossible date.
 */
export function normalizeDate(input: DateInput): string | undefined {
  if (input instanceof Date) {
    return Number.isNaN(input.getTime()) ? undefined : input.toISOString()
  }
  const text = input.trim()
  if (BARE_DAY.test(text)) return parseIsoDate(text) ? text : undefined
  const prefix = text.slice(0, 10)
  if (BARE_DAY.test(prefix) && !parseIsoDate(prefix)) return undefined
  const date = new Date(text)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

/** Like {@link normalizeDate} but throws a `RangeError` naming the field. */
export function requireDate(input: DateInput, field: string): string {
  const value = normalizeDate(input)
  if (value === undefined) throw new RangeError(`${field}: invalid date ${String(input)}`)
  return value
}

/** Full ISO instant (a bare day becomes midnight UTC). */
export function toInstant(input: DateInput, field: string): Date {
  const value = requireDate(input, field)
  return new Date(BARE_DAY.test(value) ? `${value}T00:00:00.000Z` : value)
}

/** True for an absolute `http:` or `https:` URL with no credentials. */
export function isAbsoluteHttpUrl(text: string): boolean {
  try {
    const url = new URL(text)
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password
  } catch {
    return false
  }
}

export function requireAbsoluteUrl(text: string, field: string): string {
  if (!isAbsoluteHttpUrl(text))
    throw new RangeError(`${field}: expected an absolute http(s) URL, got ${text}`)
  return text
}

/** Resolve `path` against `base` when it is not already absolute. */
export function absolutize(pathOrUrl: string, base: string | undefined): string {
  if (isAbsoluteHttpUrl(pathOrUrl) || base === undefined) return pathOrUrl
  return new URL(pathOrUrl, base).toString()
}
