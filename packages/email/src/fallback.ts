/**
 * Fallback chain: try providers in order until one accepts the message.
 *
 * Default policy ({@link defaultShouldFallback}) moves to the next provider
 * only when the failure is about **this provider**, not the message:
 *
 * | Falls back | Stops |
 * | --- | --- |
 * | `configuration`, `authentication`, `quota`, `rate_limited`, `unavailable` | `validation`, `rejected`, `aborted`, `idempotency_conflict`, `in_progress`, `unknown` |
 * | `network`, `timeout` only with `fallbackOnAmbiguous: true` | |
 *
 * `rejected` stops on purpose: a provider that refuses a recipient (bounce
 * list, suppression, spam complaint) must not be bypassed by sending through
 * another one. `network` / `timeout` stop by default because the first
 * provider may already have accepted the message, and idempotency keys do not
 * cross providers.
 *
 * Compose with `withRetry` per provider (`[withRetry(a), withRetry(b)]`) to
 * retry each before moving on.
 *
 * The chain's capabilities are the intersection of its members', so a message
 * that one member cannot carry is rejected up front.
 *
 * When every provider fails, the error has the last failure's kind and lists
 * each failure in `details.failures`.
 *
 * @example
 * ```ts
 * import { createFallbackProvider } from "@bib/email/fallback"
 *
 * const email = createFallbackProvider([withRetry(postmark), withRetry(ses)])
 * ```
 */

import { err, ok, type Result } from "@bib/shared/result"
import { EmailError, type EmailErrorKind } from "./errors.ts"
import type { EmailMessage } from "./message.ts"
import {
  checkCapabilities,
  type EmailProvider,
  type ProviderCapabilities,
  type SendOptions,
  type SendOutcome,
} from "./provider.ts"

const FALLBACK_KINDS: ReadonlySet<EmailErrorKind> = new Set([
  "configuration",
  "authentication",
  "quota",
  "rate_limited",
  "unavailable",
])

/** The default predicate. `fallbackOnAmbiguous` adds `network` and `timeout`. */
export function defaultShouldFallback(error: EmailError, fallbackOnAmbiguous = false): boolean {
  if (FALLBACK_KINDS.has(error.kind)) return true
  return fallbackOnAmbiguous && (error.kind === "network" || error.kind === "timeout")
}

/** Options for {@link createFallbackProvider}. */
export interface FallbackOptions {
  /** Default `"fallback(<a>,<b>,...)"`. */
  readonly name?: string
  /** Override the policy entirely. */
  readonly shouldFallback?: (error: EmailError, provider: EmailProvider) => boolean
  /** Default false. Ignored when `shouldFallback` is given. */
  readonly fallbackOnAmbiguous?: boolean
  /** Called before moving to the next provider. */
  readonly onFallback?: (event: { from: string; to: string; error: EmailError }) => void
}

/** The intersection of several providers' capabilities. */
export function intersectCapabilities(list: readonly ProviderCapabilities[]): ProviderCapabilities {
  const sizes = list.map((c) => c.maxAttachmentBytes).filter((n): n is number => n !== undefined)
  return {
    maxRecipients: Math.min(...list.map((c) => c.maxRecipients)),
    attachments: list.every((c) => c.attachments),
    ...(sizes.length === 0 ? {} : { maxAttachmentBytes: Math.min(...sizes) }),
    idempotency: list.every((c) => c.idempotency),
    tags: list.every((c) => c.tags),
    metadata: list.every((c) => c.metadata),
    customHeaders: list.every((c) => c.customHeaders),
  }
}

/** Create a provider that tries `providers` in order. Throws when the list is empty. */
export function createFallbackProvider(
  providers: readonly EmailProvider[],
  options: FallbackOptions = {},
): EmailProvider {
  if (providers.length === 0)
    throw new RangeError("createFallbackProvider needs at least one provider")
  const name = options.name ?? `fallback(${providers.map((p) => p.name).join(",")})`
  const capabilities = intersectCapabilities(providers.map((p) => p.capabilities))
  const shouldFallback =
    options.shouldFallback ??
    ((error: EmailError) => defaultShouldFallback(error, options.fallbackOnAmbiguous ?? false))

  async function send(message: EmailMessage, sendOptions?: SendOptions): Promise<SendOutcome> {
    const fits = checkCapabilities(name, capabilities, message)
    if (!fits.ok) return fits
    const failures: EmailError[] = []
    for (let i = 0; i < providers.length; i++) {
      const provider = providers[i]
      if (provider === undefined) continue
      const outcome = await provider.send(message, sendOptions)
      if (outcome.ok) return outcome
      failures.push(outcome.error)
      const next = providers[i + 1]
      if (next === undefined || !shouldFallback(outcome.error, provider)) break
      options.onFallback?.({ from: provider.name, to: next.name, error: outcome.error })
    }
    const last = failures[failures.length - 1]
    if (last === undefined) {
      return err(new EmailError("unknown", "no provider attempted the send", { provider: name }))
    }
    if (failures.length === 1) return err(last)
    return err(
      new EmailError(last.kind, `${failures.length} providers failed; last: ${last.message}`, {
        provider: last.provider,
        httpStatus: last.httpStatus,
        providerCode: last.providerCode,
        retryAfterMs: last.retryAfterMs,
        cause: last,
        details: {
          chain: name,
          failures: failures.map((f) => ({
            provider: f.provider,
            kind: f.kind,
            message: f.message,
          })),
        },
      }),
    )
  }

  /** Healthy when at least one member is healthy. */
  async function healthCheck(opts?: {
    readonly signal?: AbortSignal
  }): Promise<Result<void, EmailError>> {
    let lastError: EmailError | undefined
    for (const provider of providers) {
      if (provider.healthCheck === undefined) return ok(undefined)
      const r = await provider.healthCheck(opts)
      if (r.ok) return r
      lastError = r.error
    }
    return err(lastError ?? new EmailError("unknown", "no provider is healthy", { provider: name }))
  }

  return { name, capabilities, send, healthCheck }
}
