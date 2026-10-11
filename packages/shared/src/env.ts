/**
 * Typed, fail-fast environment-variable access.
 *
 * Every reader takes an optional `source` (defaults to `process.env`) so code is
 * testable without mutating global state and works in runtimes that inject a
 * different env object. Empty and whitespace-only values are treated as unset —
 * `FOO=` in a `.env` file almost always means "not configured".
 *
 * Errors name the variable and the bad value's *shape* but never echo the value
 * itself, since env vars routinely hold sensitive data such as credentials.
 *
 * @example
 * ```ts
 * import { requireEnv, parseEnvInt, parseEnvBoolean } from "@bib/shared/env"
 *
 * const databaseUrl = requireEnv("DATABASE_URL")              // throws EnvError if missing
 * const port = parseEnvInt("PORT", { default: 3000, min: 1, max: 65535 })
 * const verbose = parseEnvBoolean("VERBOSE", { default: false }) // "true"/"1"/"yes"/"on"
 * ```
 */

/** A string-to-string environment map. */
export type EnvSource = Readonly<Record<string, string | undefined>>

/** Thrown for a missing or malformed variable. */
export class EnvError extends Error {
  readonly variable: string
  constructor(variable: string, message: string) {
    super(`${variable}: ${message}`)
    this.name = "EnvError"
    this.variable = variable
  }
}

function defaultSource(): EnvSource {
  return typeof process === "undefined" ? {} : process.env
}

/** The trimmed value, or `fallback` when unset/blank. */
export function getEnv(name: string, fallback?: string, source?: EnvSource): string | undefined {
  const raw = (source ?? defaultSource())[name]
  const value = raw?.trim()
  return value === undefined || value === "" ? fallback : value
}

/** The trimmed value; throws {@link EnvError} when unset or blank. */
export function requireEnv(name: string, source?: EnvSource): string {
  const value = getEnv(name, undefined, source)
  if (value === undefined) throw new EnvError(name, "is required but not set")
  return value
}

const TRUE_VALUES = new Set(["true", "1", "yes", "on", "y"])
const FALSE_VALUES = new Set(["false", "0", "no", "off", "n"])

/** Options for typed readers. */
export interface EnvReadOptions<T> {
  /** Used when unset. Omit to make the variable required. */
  readonly default?: T
  readonly source?: EnvSource
}

/**
 * Parse a boolean. Accepts (case-insensitively) `true/1/yes/on/y` and
 * `false/0/no/off/n`; anything else throws rather than silently becoming false.
 */
export function parseEnvBoolean(name: string, options: EnvReadOptions<boolean> = {}): boolean {
  const value = getEnv(name, undefined, options.source)
  if (value === undefined) {
    if (options.default !== undefined) return options.default
    throw new EnvError(name, "is required but not set")
  }
  const lower = value.toLowerCase()
  if (TRUE_VALUES.has(lower)) return true
  if (FALSE_VALUES.has(lower)) return false
  throw new EnvError(name, "must be a boolean (true/false, 1/0, yes/no, on/off)")
}

/**
 * Parse a base-10 integer, optionally bounded. Rejects `"12abc"`, `"1.5"`,
 * `"0x10"`, and values outside the safe-integer range.
 */
export function parseEnvInt(
  name: string,
  options: EnvReadOptions<number> & { readonly min?: number; readonly max?: number } = {},
): number {
  const value = getEnv(name, undefined, options.source)
  if (value === undefined) {
    if (options.default !== undefined) return options.default
    throw new EnvError(name, "is required but not set")
  }
  if (!/^[+-]?\d+$/.test(value)) throw new EnvError(name, "must be an integer")
  const n = Number(value)
  if (!Number.isSafeInteger(n)) throw new EnvError(name, "is outside the safe integer range")
  if (options.min !== undefined && n < options.min) {
    throw new EnvError(name, `must be >= ${options.min}`)
  }
  if (options.max !== undefined && n > options.max) {
    throw new EnvError(name, `must be <= ${options.max}`)
  }
  return n
}

/** Parse one of a fixed set of values (case-sensitive). */
export function parseEnvEnum<const T extends string>(
  name: string,
  allowed: readonly T[],
  options: EnvReadOptions<T> = {},
): T {
  const value = getEnv(name, undefined, options.source)
  if (value === undefined) {
    if (options.default !== undefined) return options.default
    throw new EnvError(name, "is required but not set")
  }
  for (const candidate of allowed) if (candidate === value) return candidate
  throw new EnvError(name, `must be one of: ${allowed.join(", ")}`)
}
