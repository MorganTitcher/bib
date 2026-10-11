/**
 * Every email failure is an {@link EmailError} with a `kind`. The kind is the
 * one thing callers branch on: it decides whether a retry can help
 * (`retryable`), whether a fallback provider should be tried, and what a
 * dashboard groups by.
 *
 * Retryable kinds are the transient ones: `rate_limited`, `unavailable`
 * (HTTP 5xx), `network`, `timeout` and `in_progress`. Everything else is
 * permanent for this message: retrying an invalid address, a revoked key or a
 * rejected recipient only burns quota.
 *
 * `network` and `timeout` are *ambiguous*: the provider may have accepted the
 * message before the connection dropped. See `withRetry`'s `retryAmbiguous`
 * option.
 *
 * @example
 * ```ts
 * import { EmailError, classifyHttpStatus } from "@bib/email/errors"
 *
 * const e = new EmailError(classifyHttpStatus(503), "provider down", { provider: "resend" })
 * e.kind // "unavailable"
 * e.retryable // true
 * ```
 */

import { AppError } from "@bib/shared/errors"

/** Why a send failed. */
export type EmailErrorKind =
  /** The message itself is malformed (bad address, missing body). Never sent. */
  | "validation"
  /** The provider is misconfigured locally (missing key, unsupported feature). */
  | "configuration"
  /** HTTP 401/403: bad, revoked or under-privileged credentials. */
  | "authentication"
  /** The provider understood the request and refused it (4xx). */
  | "rejected"
  /** HTTP 429 or an equivalent throttle. Retry after `retryAfterMs`. */
  | "rate_limited"
  /** A daily/monthly sending quota is exhausted. Retrying soon will not help. */
  | "quota"
  /** HTTP 5xx or an explicit "service unavailable". */
  | "unavailable"
  /** The request never got a response (DNS, reset, TLS). Ambiguous. */
  | "network"
  /** No response within the deadline. Ambiguous. */
  | "timeout"
  /** The caller's `AbortSignal` fired. */
  | "aborted"
  /** The same idempotency key is being processed right now. Retry later. */
  | "in_progress"
  /** The idempotency key was reused with a different message. */
  | "idempotency_conflict"
  /** Anything that did not map cleanly. Treated as permanent. */
  | "unknown"

/** Every {@link EmailErrorKind}, for iteration and validation. */
export const EMAIL_ERROR_KINDS: readonly EmailErrorKind[] = [
  "validation",
  "configuration",
  "authentication",
  "rejected",
  "rate_limited",
  "quota",
  "unavailable",
  "network",
  "timeout",
  "aborted",
  "in_progress",
  "idempotency_conflict",
  "unknown",
]

const RETRYABLE_KINDS: ReadonlySet<EmailErrorKind> = new Set<EmailErrorKind>([
  "rate_limited",
  "unavailable",
  "network",
  "timeout",
  "in_progress",
])

const AMBIGUOUS_KINDS: ReadonlySet<EmailErrorKind> = new Set<EmailErrorKind>(["network", "timeout"])

const STATUS_FOR_KIND: Readonly<Record<EmailErrorKind, number>> = {
  validation: 400,
  configuration: 500,
  authentication: 401,
  rejected: 422,
  rate_limited: 429,
  quota: 429,
  unavailable: 503,
  network: 502,
  timeout: 504,
  aborted: 499,
  in_progress: 409,
  idempotency_conflict: 409,
  unknown: 500,
}

/** Is a failure of this kind worth retrying? */
export function isRetryableKind(kind: EmailErrorKind): boolean {
  return RETRYABLE_KINDS.has(kind)
}

/**
 * Could the provider have accepted the message despite the failure? True for
 * `network` and `timeout`: the request may have landed before the connection
 * died. Retrying these without an idempotency key can send a duplicate.
 */
export function isAmbiguousKind(kind: EmailErrorKind): boolean {
  return AMBIGUOUS_KINDS.has(kind)
}

/** Extra context for an {@link EmailError}. Keep it free of secrets and message content. */
export interface EmailErrorOptions {
  /** Provider name, e.g. `"postmark"`. */
  readonly provider?: string | undefined
  /** HTTP status the provider returned, when there was a response. */
  readonly httpStatus?: number | undefined
  /** The provider's own error code or name, e.g. `"rate_limit_exceeded"` or `406`. */
  readonly providerCode?: string | undefined
  /** Server hint for how long to wait before retrying, in milliseconds. */
  readonly retryAfterMs?: number | undefined
  readonly cause?: unknown
  readonly details?: Readonly<Record<string, unknown>>
}

/** A classified email failure. Safe to log: messages never contain credentials. */
export class EmailError extends AppError {
  readonly kind: EmailErrorKind
  readonly provider: string | undefined
  readonly httpStatus: number | undefined
  readonly providerCode: string | undefined
  readonly retryAfterMs: number | undefined

  constructor(kind: EmailErrorKind, message: string, options: EmailErrorOptions = {}) {
    const details: Record<string, unknown> = { ...options.details, kind }
    if (options.provider !== undefined) details.provider = options.provider
    if (options.httpStatus !== undefined) details.httpStatus = options.httpStatus
    if (options.providerCode !== undefined) details.providerCode = options.providerCode
    super(`email_${kind}`, message, STATUS_FOR_KIND[kind], {
      cause: options.cause,
      details,
    })
    this.name = "EmailError"
    this.kind = kind
    this.provider = options.provider
    this.httpStatus = options.httpStatus
    this.providerCode = options.providerCode
    const hint = options.retryAfterMs
    this.retryAfterMs = hint !== undefined && Number.isFinite(hint) && hint >= 0 ? hint : undefined
  }

  /** Whether a retry of the same message could succeed. */
  get retryable(): boolean {
    return isRetryableKind(this.kind)
  }

  /** Whether the provider may have accepted the message anyway. */
  get ambiguous(): boolean {
    return isAmbiguousKind(this.kind)
  }
}

/** Narrow an unknown value to {@link EmailError}. */
export function isEmailError(value: unknown): value is EmailError {
  return value instanceof EmailError
}

/**
 * The default mapping from an HTTP status to a kind. Providers refine it with
 * their own error codes (e.g. a 429 that means "monthly quota" becomes `quota`).
 *
 * @example
 * ```ts
 * classifyHttpStatus(429) // "rate_limited"
 * classifyHttpStatus(502) // "unavailable"
 * classifyHttpStatus(422) // "rejected"
 * ```
 */
export function classifyHttpStatus(status: number): EmailErrorKind {
  if (status === 401 || status === 403) return "authentication"
  if (status === 408) return "timeout"
  if (status === 409) return "idempotency_conflict"
  if (status === 429) return "rate_limited"
  if (status >= 500 && status <= 599) return "unavailable"
  if (status >= 400 && status <= 499) return "rejected"
  return "unknown"
}
