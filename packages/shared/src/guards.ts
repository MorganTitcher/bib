/**
 * Runtime type guards and assertions. Use these at boundaries (parsed JSON,
 * environment variables, third-party payloads) to turn `unknown` into a typed
 * value without `as` casts.
 *
 * @example
 * ```ts
 * import { isRecord, isString, assert } from "@bib/shared/guards"
 *
 * const body: unknown = JSON.parse(raw)
 * assert(isRecord(body) && isString(body.email), "body.email must be a string")
 * body.email.toLowerCase() // typed as string
 * ```
 */

/**
 * A nominal ("branded") type: structurally a `T`, but not assignable from a
 * plain `T`. Use it to keep an `OrderId` from being passed where a
 * `CustomerId` is expected.
 *
 * @example
 * ```ts
 * type CustomerId = Brand<string, "CustomerId">
 * const id = "cus_123" as CustomerId // brand once, at the boundary
 * ```
 */
export type Brand<T, B extends string> = T & { readonly __brand: B }

/** A plain object: non-null, typeof "object", and not an array. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** A string primitive. */
export function isString(value: unknown): value is string {
  return typeof value === "string"
}

/** A string with at least one non-whitespace character. */
export function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

/** A FINITE number. `NaN`, `Infinity`, and `-Infinity` are rejected. */
export function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

/** A boolean primitive. */
export function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean"
}

/** An array with at least one element; narrows to a non-empty tuple type. */
export function isNonEmptyArray<T>(value: readonly T[]): value is readonly [T, ...T[]] {
  return value.length > 0
}

/** Neither `null` nor `undefined`. Handy as a `.filter(isNonNullish)` predicate. */
export function isNonNullish<T>(value: T): value is NonNullable<T> {
  return value !== null && value !== undefined
}

/** Membership test against a readonly tuple of literals; narrows to the union. */
export function isOneOf<const T extends readonly unknown[]>(
  allowed: T,
  value: unknown,
): value is T[number] {
  return allowed.includes(value)
}

/** Thrown by {@link assert} and {@link assertNever}. */
export class AssertionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "AssertionError"
  }
}

/**
 * Throw an {@link AssertionError} when `condition` is falsy; narrows otherwise.
 * Use for invariants that indicate a bug, not for user-input validation.
 */
export function assert(condition: unknown, message = "Assertion failed"): asserts condition {
  if (!condition) throw new AssertionError(message)
}

/**
 * Compile-time exhaustiveness check for `switch` over a union. If a new member
 * is added and not handled, the call no longer type-checks.
 *
 * @example
 * ```ts
 * switch (shape.kind) {
 *   case "circle": return ...
 *   case "square": return ...
 *   default: return assertNever(shape)
 * }
 * ```
 */
export function assertNever(value: never, message?: string): never {
  throw new AssertionError(message ?? `Unexpected value: ${safeDescribe(value)}`)
}

function safeDescribe(value: unknown): string {
  try {
    return typeof value === "string" ? value : JSON.stringify(value)
  } catch {
    return String(value)
  }
}

/** Normalize anything thrown into an `Error` (the original is kept as `cause`). */
export function toError(thrown: unknown): Error {
  if (thrown instanceof Error) return thrown
  if (typeof thrown === "string") return new Error(thrown)
  return new Error(safeDescribe(thrown), { cause: thrown })
}

/** A human-readable message for anything thrown. */
export function errorMessage(thrown: unknown): string {
  return toError(thrown).message
}
