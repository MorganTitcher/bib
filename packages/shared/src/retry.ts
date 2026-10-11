/**
 * Retry with exponential backoff and full jitter.
 *
 * Delay before retry `n` (0-based) is `min(maxDelayMs, initialDelayMs * multiplier^n)`,
 * then — with jitter on (the default) — a uniform sample in `[0, thatDelay]`
 * ("full jitter", which best decorrelates many clients retrying at once; see
 * https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/).
 *
 * When an error is a {@link RateLimitError} carrying `retryAfterMs`, the server
 * already told us how long to wait. That hint is treated as a FLOOR: the wait is
 * `retryAfterMs` plus up to 10% upward jitter, clamped to `maxDelayMs`. Full
 * jitter would sample below the floor and retry into a window that is still
 * closed.
 *
 * `sleep` and `rng` are injectable so tests run instantly and deterministically.
 *
 * @example
 * ```ts
 * import { retryWithBackoff, NonRetryableError } from "@bib/shared/retry"
 *
 * const body = await retryWithBackoff(
 *   async () => {
 *     const res = await fetch(url)
 *     if (res.status === 400) throw new NonRetryableError("bad request") // stop now
 *     if (!res.ok) throw new Error(`HTTP ${res.status}`) // retry
 *     return res.json()
 *   },
 *   { maxAttempts: 4, initialDelayMs: 250, onRetry: ({ attempt, delayMs }) => log(attempt, delayMs) },
 * )
 * ```
 */

import { delay } from "./async.ts"
import { RateLimitError } from "./errors.ts"

/** Throw (or wrap) this to stop retrying immediately. */
export class NonRetryableError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = "NonRetryableError"
  }
}

/** Default predicate: everything is retryable except {@link NonRetryableError}. */
export function isRetryableError(error: unknown): boolean {
  return !(error instanceof NonRetryableError)
}

/** Information passed to `onRetry` before each wait. */
export interface RetryEvent {
  /** The attempt that just failed, 1-based. */
  readonly attempt: number
  readonly error: unknown
  /** How long we will wait before the next attempt. */
  readonly delayMs: number
}

/** Options for {@link retryWithBackoff}. */
export interface RetryOptions {
  /** Total attempts including the first. Default 3. Must be an integer >= 1. */
  readonly maxAttempts?: number
  /** Base delay before the first retry. Default 500 ms. */
  readonly initialDelayMs?: number
  /** Cap on any single delay. Default 30 000 ms. */
  readonly maxDelayMs?: number
  /** Growth factor per attempt. Default 2. */
  readonly multiplier?: number
  /** Full jitter on computed delays. Default true. */
  readonly jitter?: boolean
  /** Return false to stop retrying for this error. Default {@link isRetryableError}. */
  readonly shouldRetry?: (error: unknown, attempt: number) => boolean
  /** Called before each wait. */
  readonly onRetry?: (event: RetryEvent) => void
  /** Cancels the in-flight wait and prevents further attempts. */
  readonly signal?: AbortSignal
  /** Uniform `[0, 1)` source. Default `Math.random`. */
  readonly rng?: () => number
  /** Wait implementation. Default {@link delay}. */
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
}

/**
 * The un-jittered exponential delay for 0-based `attempt`, capped at `maxDelayMs`.
 *
 * @example
 * ```ts
 * calculateBackoffDelay(0, 500, 30_000) // 500
 * calculateBackoffDelay(3, 500, 30_000) // 4000
 * calculateBackoffDelay(20, 500, 30_000) // 30000
 * ```
 */
export function calculateBackoffDelay(
  attempt: number,
  initialDelayMs: number,
  maxDelayMs: number,
  multiplier = 2,
): number {
  const raw = initialDelayMs * multiplier ** Math.max(0, attempt)
  return Number.isFinite(raw) ? Math.min(raw, maxDelayMs) : maxDelayMs
}

const SERVER_HINT_JITTER_RATIO = 0.1

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw signal.reason !== undefined
      ? signal.reason
      : new DOMException("The operation was aborted.", "AbortError")
  }
}

/**
 * Call `fn` until it succeeds, a non-retryable error occurs, attempts run out,
 * or `signal` aborts. Rethrows the last error (or the abort reason). `fn`
 * receives the 1-based attempt number.
 */
export async function retryWithBackoff<T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new RangeError(`maxAttempts must be an integer >= 1, got ${maxAttempts}`)
  }
  const initialDelayMs = options.initialDelayMs ?? 500
  const maxDelayMs = options.maxDelayMs ?? 30_000
  const multiplier = options.multiplier ?? 2
  const jitter = options.jitter ?? true
  const shouldRetry = options.shouldRetry ?? isRetryableError
  const rng = options.rng ?? Math.random
  const sleep = options.sleep ?? delay
  const { signal, onRetry } = options

  for (let attempt = 1; ; attempt++) {
    throwIfAborted(signal)
    try {
      return await fn(attempt)
    } catch (error) {
      if (attempt >= maxAttempts || !shouldRetry(error, attempt)) throw error
      throwIfAborted(signal)
      let delayMs: number
      const hint = error instanceof RateLimitError ? error.retryAfterMs : undefined
      if (hint !== undefined) {
        const spread = jitter ? rng() * hint * SERVER_HINT_JITTER_RATIO : 0
        delayMs = Math.min(hint + spread, maxDelayMs)
      } else {
        delayMs = calculateBackoffDelay(attempt - 1, initialDelayMs, maxDelayMs, multiplier)
        if (jitter) delayMs = rng() * delayMs
      }
      onRetry?.({ attempt, error, delayMs })
      await sleep(delayMs, signal)
    }
  }
}
