/**
 * Passive health tracking for a provider.
 *
 * `withHealth(provider)` watches every `send` and `healthCheck` and keeps a
 * small, log-safe status: consecutive failures, the last success, and the last
 * error. A provider is reported unhealthy after `failureThreshold` (default 3)
 * consecutive provider-side failures; one success resets the count.
 *
 * Only failures that say something about the provider count. Failures caused
 * by the message (`validation`, `rejected`, `idempotency_conflict`), by the
 * caller (`aborted`) or by concurrency (`in_progress`) are ignored, so a burst
 * of bad input does not mark a working provider unhealthy.
 *
 * The status is advisory: the decorator never blocks a send. Use it for
 * dashboards, readiness probes or to reorder a fallback chain.
 *
 * @example
 * ```ts
 * import { withHealth } from "@bib/email/health"
 *
 * const provider = withHealth(withRetry(resend))
 * await provider.send(message)
 * provider.health() // { healthy: true, consecutiveFailures: 0, ... }
 * ```
 */

import type { Result } from "@bib/shared/result"
import type { EmailError, EmailErrorKind } from "./errors.ts"
import type { EmailMessage } from "./message.ts"
import type { EmailProvider, SendOptions, SendOutcome } from "./provider.ts"

const IGNORED_KINDS: ReadonlySet<EmailErrorKind> = new Set([
  "validation",
  "rejected",
  "idempotency_conflict",
  "aborted",
  "in_progress",
])

/** Whether `error` counts against the provider's health by default. */
export function countsAgainstHealth(error: EmailError): boolean {
  return !IGNORED_KINDS.has(error.kind)
}

/** A snapshot of a provider's health. */
export interface ProviderHealth {
  readonly provider: string
  readonly healthy: boolean
  readonly consecutiveFailures: number
  readonly lastSuccessAt?: string
  readonly lastFailureAt?: string
  readonly lastError?: { readonly kind: EmailErrorKind; readonly message: string }
  /** Sends observed, including failures that do not count. */
  readonly sends: number
  /** Failures that counted against health. */
  readonly failures: number
}

/** Options for {@link withHealth}. */
export interface HealthOptions {
  /** Consecutive counted failures before `healthy` turns false. Default 3. */
  readonly failureThreshold?: number
  /** Override which errors count. Default {@link countsAgainstHealth}. */
  readonly counts?: (error: EmailError) => boolean
  /** Called when `healthy` flips. */
  readonly onChange?: (health: ProviderHealth) => void
  readonly now?: () => Date
}

/** A provider decorated with health tracking. */
export interface HealthTrackedProvider extends EmailProvider {
  health(): ProviderHealth
  /** Forget all observations. */
  reset(): void
}

/** Wrap a provider with passive health tracking. */
export function withHealth(
  provider: EmailProvider,
  options: HealthOptions = {},
): HealthTrackedProvider {
  const threshold = Math.max(1, options.failureThreshold ?? 3)
  const counts = options.counts ?? countsAgainstHealth
  const now = options.now ?? (() => new Date())

  let consecutiveFailures = 0
  let sends = 0
  let failures = 0
  let lastSuccessAt: string | undefined
  let lastFailureAt: string | undefined
  let lastError: { kind: EmailErrorKind; message: string } | undefined

  function snapshot(): ProviderHealth {
    return {
      provider: provider.name,
      healthy: consecutiveFailures < threshold,
      consecutiveFailures,
      ...(lastSuccessAt === undefined ? {} : { lastSuccessAt }),
      ...(lastFailureAt === undefined ? {} : { lastFailureAt }),
      ...(lastError === undefined ? {} : { lastError }),
      sends,
      failures,
    }
  }

  function observe(outcome: Result<unknown, EmailError>): void {
    const before = consecutiveFailures < threshold
    if (outcome.ok) {
      consecutiveFailures = 0
      lastSuccessAt = now().toISOString()
    } else if (counts(outcome.error)) {
      consecutiveFailures += 1
      failures += 1
      lastFailureAt = now().toISOString()
      lastError = { kind: outcome.error.kind, message: outcome.error.message }
    }
    const after = consecutiveFailures < threshold
    if (before !== after) options.onChange?.(snapshot())
  }

  async function send(message: EmailMessage, sendOptions?: SendOptions): Promise<SendOutcome> {
    sends += 1
    const outcome = await provider.send(message, sendOptions)
    observe(outcome)
    return outcome
  }

  const health = provider.healthCheck
  const tracked: HealthTrackedProvider = {
    name: provider.name,
    capabilities: provider.capabilities,
    send,
    health: snapshot,
    reset() {
      consecutiveFailures = 0
      sends = 0
      failures = 0
      lastSuccessAt = undefined
      lastFailureAt = undefined
      lastError = undefined
    },
  }
  if (health === undefined) return tracked
  return {
    ...tracked,
    async healthCheck(opts?: { readonly signal?: AbortSignal }): Promise<Result<void, EmailError>> {
      const result = await health.call(provider, opts)
      observe(result)
      return result
    },
  }
}
