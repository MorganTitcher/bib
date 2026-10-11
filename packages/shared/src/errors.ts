/**
 * A small typed error hierarchy. Every error carries a stable machine-readable
 * `code` (safe to branch on and to return from an API) and an optional
 * `cause`. Messages are for humans and may change; codes may not.
 *
 * Keep messages free of sensitive values (credentials, personal data): errors
 * end up in logs. Put identifiers in `details` only when they are safe to log.
 *
 * @example
 * ```ts
 * import { NotFoundError, isAppError } from "@bib/shared/errors"
 *
 * try {
 *   throw new NotFoundError("Invoice not found", { details: { invoiceId: "inv_42" } })
 * } catch (e) {
 *   if (isAppError(e)) console.log(e.code, e.status) // "not_found" 404
 * }
 * ```
 */

/** Options accepted by every {@link AppError}. */
export interface AppErrorOptions {
  /** The underlying error, if any. */
  readonly cause?: unknown
  /** Structured, log-safe context. */
  readonly details?: Readonly<Record<string, unknown>>
}

/** Base class. Subclass it rather than throwing a bare `AppError` where a subclass fits. */
export class AppError extends Error {
  /** Stable machine-readable identifier, e.g. `"not_found"`. */
  readonly code: string
  /** Suggested HTTP status for transports that need one. */
  readonly status: number
  /** Structured, log-safe context. */
  readonly details: Readonly<Record<string, unknown>>

  constructor(code: string, message: string, status = 500, options: AppErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = "AppError"
    this.code = code
    this.status = status
    this.details = options.details ?? {}
  }

  /** A plain, serializable view (no stack, no cause) suitable for an API response. */
  toJSON(): { code: string; message: string; details: Readonly<Record<string, unknown>> } {
    return { code: this.code, message: this.message, details: this.details }
  }
}

/** One field-level validation problem. */
export interface FieldIssue {
  /** Dotted path to the field, e.g. `"address.postcode"`. Empty for whole-object issues. */
  readonly path: string
  readonly message: string
}

/** Input failed validation. `issues` lists every problem, not just the first. */
export class ValidationError extends AppError {
  readonly issues: readonly FieldIssue[]

  constructor(message: string, issues: readonly FieldIssue[] = [], options: AppErrorOptions = {}) {
    super("validation_failed", message, 400, options)
    this.name = "ValidationError"
    this.issues = issues
  }
}

/** The requested resource does not exist (or is not visible to the caller). */
export class NotFoundError extends AppError {
  constructor(message = "Not found", options: AppErrorOptions = {}) {
    super("not_found", message, 404, options)
    this.name = "NotFoundError"
  }
}

/** The request conflicts with current state (duplicate key, stale version). */
export class ConflictError extends AppError {
  constructor(message = "Conflict", options: AppErrorOptions = {}) {
    super("conflict", message, 409, options)
    this.name = "ConflictError"
  }
}

/** A rate limit was hit. `retryAfterMs` is the server's hint, when known. */
export class RateLimitError extends AppError {
  readonly retryAfterMs: number | undefined

  constructor(
    message = "Rate limited",
    options: AppErrorOptions & { readonly retryAfterMs?: number } = {},
  ) {
    super("rate_limited", message, 429, options)
    this.name = "RateLimitError"
    const hint = options.retryAfterMs
    this.retryAfterMs = hint !== undefined && Number.isFinite(hint) && hint >= 0 ? hint : undefined
  }
}

/** Narrow an unknown thrown value to {@link AppError}. */
export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError
}

/**
 * Parse an HTTP `Retry-After` header (delta-seconds or an HTTP date) into
 * milliseconds from `now`. Returns `undefined` for missing or unparseable input.
 *
 * @example
 * ```ts
 * parseRetryAfter("120") // 120_000
 * ```
 */
export function parseRetryAfter(
  header: string | null | undefined,
  now: number = Date.now(),
): number | undefined {
  if (header === null || header === undefined) return undefined
  const trimmed = header.trim()
  if (trimmed === "") return undefined
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000
  // A signed number is malformed delta-seconds; Date.parse would accept it as a year.
  if (/^[+-]\d+$/.test(trimmed)) return undefined
  const at = Date.parse(trimmed)
  if (Number.isNaN(at)) return undefined
  return Math.max(0, at - now)
}
