/**
 * Retry decorator built on `@bib/shared/retry`.
 *
 * Classification (from {@link EmailError.kind}):
 *
 * | Kind | Retried? |
 * | --- | --- |
 * | `rate_limited` (429), `unavailable` (5xx), `in_progress` | yes |
 * | `network`, `timeout` | see `retryAmbiguous` |
 * | everything else (`validation`, `rejected`, `authentication`, `quota`, ...) | no — permanent |
 *
 * `network` and `timeout` are **ambiguous**: the provider may have accepted
 * the message before the connection failed. Retrying a provider without an
 * idempotency key can then deliver twice. `retryAmbiguous` decides:
 *
 * - `"idempotent-only"` (default): retry only when the provider honours an
 *   idempotency key (`capabilities.idempotency`).
 * - `"always"`: accept the duplicate risk.
 * - `"never"`: treat them as permanent.
 *
 * One idempotency key is used for every attempt. When the caller supplied none
 * and the provider honours keys, a UUIDv7 is generated so retries dedupe.
 *
 * A `Retry-After` hint is a floor on the wait. If it exceeds `maxDelayMs` the
 * error is returned immediately: waiting less than the server asked is a
 * wasted attempt.
 *
 * @example
 * ```ts
 * import { withRetry } from "@bib/email/retry"
 *
 * const provider = withRetry(createResendProvider({ apiKey }), { maxAttempts: 4 })
 * ```
 */

import { RateLimitError } from "@bib/shared/errors"
import { uuidv7 } from "@bib/shared/ids"
import { err, ok, type Result } from "@bib/shared/result"
import { retryWithBackoff } from "@bib/shared/retry"
import { EmailError, isAmbiguousKind, isRetryableKind } from "./errors.ts"
import type { EmailMessage } from "./message.ts"
import {
  type EmailProvider,
  effectiveIdempotencyKey,
  type SendOptions,
  type SendOutcome,
  type SendResult,
} from "./provider.ts"

/** How to treat `network` / `timeout` failures. */
export type RetryAmbiguousPolicy = "always" | "idempotent-only" | "never"

/** Information passed to `onRetry`. */
export interface EmailRetryEvent {
  readonly provider: string
  /** The attempt that failed, 1-based. */
  readonly attempt: number
  readonly error: EmailError
  readonly delayMs: number
}

/** Options for {@link withRetry}. */
export interface EmailRetryOptions {
  /** Total attempts including the first. Default 3. */
  readonly maxAttempts?: number
  /** Default 500 ms. */
  readonly initialDelayMs?: number
  /** Default 30 000 ms. Also the longest `Retry-After` that is honoured. */
  readonly maxDelayMs?: number
  /** Default 2. */
  readonly multiplier?: number
  /** Default true. */
  readonly jitter?: boolean
  /** Default `"idempotent-only"`. */
  readonly retryAmbiguous?: RetryAmbiguousPolicy
  readonly onRetry?: (event: EmailRetryEvent) => void
  /** For tests. */
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  readonly rng?: () => number
  /** Key generator when the caller gave none. Default `uuidv7`. */
  readonly generateKey?: () => string
}

/** Whether `error` should be retried against `provider` under `policy`. */
export function isRetryableFor(
  error: EmailError,
  provider: EmailProvider,
  policy: RetryAmbiguousPolicy = "idempotent-only",
): boolean {
  if (!isRetryableKind(error.kind)) return false
  if (!isAmbiguousKind(error.kind)) return true
  if (policy === "always") return true
  if (policy === "never") return false
  return provider.capabilities.idempotency
}

// Carries the failed outcome through retryWithBackoff. Extends RateLimitError
// so the shared helper honours `retryAfterMs` as the wait floor.
class RetrySignal extends RateLimitError {
  readonly emailError: EmailError
  constructor(error: EmailError) {
    super(
      error.message,
      error.retryAfterMs === undefined ? {} : { retryAfterMs: error.retryAfterMs },
    )
    this.emailError = error
  }
}

class FinalError extends Error {
  readonly emailError: EmailError
  constructor(error: EmailError) {
    super(error.message)
    this.emailError = error
  }
}

/** Wrap a provider so retryable failures are retried with backoff. */
export function withRetry(provider: EmailProvider, options: EmailRetryOptions = {}): EmailProvider {
  const policy = options.retryAmbiguous ?? "idempotent-only"
  const maxDelayMs = options.maxDelayMs ?? 30_000
  const generateKey = options.generateKey ?? (() => uuidv7())

  async function send(message: EmailMessage, sendOptions?: SendOptions): Promise<SendOutcome> {
    let key = effectiveIdempotencyKey(message, sendOptions)
    if (key === undefined && provider.capabilities.idempotency) key = generateKey()
    const callOptions: SendOptions = { signal: sendOptions?.signal, idempotencyKey: key }
    const signal = sendOptions?.signal
    try {
      const result: SendResult = await retryWithBackoff(
        async () => {
          const outcome = await provider.send(message, callOptions)
          if (outcome.ok) return outcome.value
          const e = outcome.error
          const retry =
            isRetryableFor(e, provider, policy) &&
            (e.retryAfterMs === undefined || e.retryAfterMs <= maxDelayMs)
          if (retry) throw new RetrySignal(e)
          throw new FinalError(e)
        },
        {
          ...(options.maxAttempts === undefined ? {} : { maxAttempts: options.maxAttempts }),
          ...(options.initialDelayMs === undefined
            ? {}
            : { initialDelayMs: options.initialDelayMs }),
          maxDelayMs,
          ...(options.multiplier === undefined ? {} : { multiplier: options.multiplier }),
          ...(options.jitter === undefined ? {} : { jitter: options.jitter }),
          ...(options.sleep === undefined ? {} : { sleep: options.sleep }),
          ...(options.rng === undefined ? {} : { rng: options.rng }),
          ...(signal === undefined ? {} : { signal }),
          shouldRetry: (error) => error instanceof RetrySignal,
          onRetry: ({ attempt, error, delayMs }) => {
            if (error instanceof RetrySignal) {
              options.onRetry?.({
                provider: provider.name,
                attempt,
                error: error.emailError,
                delayMs,
              })
            }
          },
        },
      )
      return ok(result)
    } catch (thrown) {
      if (thrown instanceof RetrySignal || thrown instanceof FinalError)
        return err(thrown.emailError)
      if (signal?.aborted) {
        return err(
          new EmailError("aborted", "send aborted while waiting to retry", {
            provider: provider.name,
          }),
        )
      }
      return err(
        new EmailError("unknown", "retry wrapper failed unexpectedly", {
          provider: provider.name,
          cause: thrown,
        }),
      )
    }
  }

  const wrapped: EmailProvider = { name: provider.name, capabilities: provider.capabilities, send }
  const health = provider.healthCheck
  if (health !== undefined) {
    return {
      ...wrapped,
      healthCheck: (opts?: { readonly signal?: AbortSignal }): Promise<Result<void, EmailError>> =>
        health.call(provider, opts),
    }
  }
  return wrapped
}
