/**
 * Locale-aware display formatting for numbers, percentages, counts, durations,
 * and byte sizes. Every function takes an explicit `locale` (default
 * `"en-US"`) so server and client renders agree — never the ambient runtime
 * locale. Non-finite input renders as `fallback` (default `"—"`) instead of
 * `"NaN"`.
 *
 * @example
 * ```ts
 * import { formatPercent, formatCompact, formatDuration, formatBytes } from "@bib/shared/format"
 *
 * formatPercent(0.4271)          // "42.7%"
 * formatCompact(1_250_000)       // "1.3M"
 * formatDuration(90_061_000)     // "1d 1h 1m 1s"
 * formatBytes(1_536)             // "1.5 KB"
 * ```
 */

import { pluralize } from "./strings.ts"

/** Rendered for `NaN` / `±Infinity` unless overridden. */
export const DEFAULT_FALLBACK = "—"

/** Shared options for numeric formatters. */
export interface NumberFormatOptions {
  readonly locale?: string
  /** Fixed number of fraction digits (min = max). */
  readonly digits?: number
  readonly fallback?: string
}

/**
 * Grouped number, e.g. `1,234.5`.
 *
 * @example
 * ```ts
 * formatNumber(1234.5)                       // "1,234.5"
 * formatNumber(1234.5, { locale: "de-DE" })  // "1.234,5"
 * formatNumber(2, { digits: 2 })             // "2.00"
 * ```
 */
export function formatNumber(value: number, options: NumberFormatOptions = {}): string {
  if (!Number.isFinite(value)) return options.fallback ?? DEFAULT_FALLBACK
  const digits = options.digits
  return new Intl.NumberFormat(options.locale ?? "en-US", {
    ...(digits === undefined
      ? { maximumFractionDigits: 3 }
      : { minimumFractionDigits: digits, maximumFractionDigits: digits }),
  }).format(value)
}

/**
 * Short form: `1.2K`, `3.4M`, `5B`. One fraction digit by default.
 */
export function formatCompact(value: number, options: NumberFormatOptions = {}): string {
  if (!Number.isFinite(value)) return options.fallback ?? DEFAULT_FALLBACK
  return new Intl.NumberFormat(options.locale ?? "en-US", {
    notation: "compact",
    maximumFractionDigits: options.digits ?? 1,
  }).format(value)
}

/**
 * Format a FRACTION as a percentage: `0.25` → `"25%"`. One fraction digit by
 * default, trailing zeros dropped (`0.5` → `"50%"`, `0.4271` → `"42.7%"`).
 * Pass `digits` for a fixed count, `signed: true` for deltas (`"+3.2%"`).
 */
export function formatPercent(
  fraction: number,
  options: NumberFormatOptions & { readonly signed?: boolean } = {},
): string {
  if (!Number.isFinite(fraction)) return options.fallback ?? DEFAULT_FALLBACK
  const digits = options.digits
  return new Intl.NumberFormat(options.locale ?? "en-US", {
    style: "percent",
    ...(digits === undefined
      ? { maximumFractionDigits: 1 }
      : { minimumFractionDigits: digits, maximumFractionDigits: digits }),
    signDisplay: options.signed ? "exceptZero" : "auto",
  }).format(fraction)
}

/**
 * `"3 invoices"`, `"1 invoice"`, `"1,204 people"`.
 *
 * @example
 * ```ts
 * formatCount(1, "invoice")        // "1 invoice"
 * formatCount(1204, "person")      // "1,204 people"
 * formatCount(2, "cactus", { plural: "cacti" }) // "2 cacti"
 * ```
 */
export function formatCount(
  count: number,
  noun: string,
  options: { readonly locale?: string; readonly plural?: string } = {},
): string {
  return `${formatNumber(count, { locale: options.locale ?? "en-US" })} ${pluralize(noun, count, options.plural)}`
}

const UNITS: ReadonlyArray<readonly [label: string, ms: number]> = [
  ["d", 86_400_000],
  ["h", 3_600_000],
  ["m", 60_000],
  ["s", 1_000],
]

/**
 * Compact human duration from milliseconds: `"1d 2h 3m 4s"`. Zero-valued units
 * are skipped; `largest` limits how many units appear (rounding down the rest).
 * Durations under one second render as `"350ms"`. Negative durations get a
 * leading `-`.
 *
 * @example
 * ```ts
 * formatDuration(5_400_000)                   // "1h 30m"
 * formatDuration(93_784_000, { largest: 2 })  // "1d 2h"
 * formatDuration(350)                         // "350ms"
 * ```
 */
export function formatDuration(
  ms: number,
  options: { readonly largest?: number; readonly fallback?: string } = {},
): string {
  if (!Number.isFinite(ms)) return options.fallback ?? DEFAULT_FALLBACK
  const sign = ms < 0 ? "-" : ""
  let rest = Math.abs(ms)
  if (rest < 1000) return `${sign}${Math.round(rest)}ms`
  const parts: string[] = []
  for (const [label, size] of UNITS) {
    const n = Math.floor(rest / size)
    rest -= n * size
    if (n > 0) parts.push(`${n}${label}`)
  }
  const largest = options.largest ?? parts.length
  return sign + parts.slice(0, Math.max(1, largest)).join(" ")
}

/**
 * Byte size. Decimal (SI, 1 KB = 1000 B) by default, which is what storage
 * vendors and most UIs show; pass `binary: true` for KiB/MiB (1024).
 *
 * @example
 * ```ts
 * formatBytes(1_500_000)              // "1.5 MB"
 * formatBytes(1_048_576, { binary: true }) // "1 MiB"
 * ```
 */
export function formatBytes(
  bytes: number,
  options: NumberFormatOptions & { readonly binary?: boolean } = {},
): string {
  if (!Number.isFinite(bytes)) return options.fallback ?? DEFAULT_FALLBACK
  const base = options.binary ? 1024 : 1000
  const units = options.binary
    ? ["B", "KiB", "MiB", "GiB", "TiB", "PiB"]
    : ["B", "KB", "MB", "GB", "TB", "PB"]
  let value = Math.abs(bytes)
  let unit = 0
  while (value >= base && unit < units.length - 1) {
    value /= base
    unit++
  }
  const signed = bytes < 0 ? -value : value
  const text = new Intl.NumberFormat(options.locale ?? "en-US", {
    maximumFractionDigits: unit === 0 ? 0 : (options.digits ?? 1),
  }).format(signed)
  return `${text} ${units[unit] ?? "B"}`
}
