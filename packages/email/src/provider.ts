/**
 * The port every adapter implements, and the capability check that runs before
 * any network call.
 *
 * Contract (verified for every adapter by `runProviderContract`):
 *
 * - `send` never throws. Every failure, including a bug in the transport, comes
 *   back as `err(EmailError)`.
 * - Adapters do **not** retry and do **not** fall back. Policy lives in the
 *   decorators (`withRetry`, `createFallbackProvider`, `withIdempotency`), so it
 *   is configured once and behaves the same for every provider.
 * - A message the provider cannot carry (too many recipients, attachments it
 *   does not support) is rejected locally as `validation` without a request.
 * - Error messages never contain credentials.
 *
 * @example
 * ```ts
 * import type { EmailProvider } from "@bib/email/provider"
 *
 * async function notify(provider: EmailProvider, message: EmailMessage) {
 *   const r = await provider.send(message)
 *   if (!r.ok && r.error.retryable) queueForLater(message)
 * }
 * ```
 */

import { err, ok, type Result } from "@bib/shared/result"
import { EmailError } from "./errors.ts"
import { allRecipients, attachmentBytes, type EmailMessage } from "./message.ts"

/** The subset of `fetch` adapters use. Inject a mock in tests. */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>

/** What a provider can carry. Checked by {@link checkCapabilities} before sending. */
export interface ProviderCapabilities {
  /** Max combined `to` + `cc` + `bcc` per message. */
  readonly maxRecipients: number
  /** Whether attachments are supported at all. */
  readonly attachments: boolean
  /** Max total decoded attachment bytes, when the provider documents one. */
  readonly maxAttachmentBytes?: number
  /** Whether the provider honours an idempotency key (so retries cannot duplicate). */
  readonly idempotency: boolean
  /** Whether tags are forwarded (otherwise they are dropped). */
  readonly tags: boolean
  /** Whether metadata is forwarded (otherwise it is dropped). */
  readonly metadata: boolean
  /** Whether custom headers are forwarded. */
  readonly customHeaders: boolean
}

/** A successful hand-off to the provider. Not a delivery receipt. */
export interface SendResult {
  /** Name of the provider that accepted the message. */
  readonly provider: string
  /**
   * The provider's message id. May be `""` when a provider omits it (documented
   * per adapter). Use it to correlate webhooks.
   */
  readonly messageId: string
  /** When the provider accepted the message (local clock), ISO-8601. */
  readonly acceptedAt: string
  /** True when `withIdempotency` returned a cached result instead of sending. */
  readonly deduplicated?: boolean
}

/** Per-call options. */
export interface SendOptions {
  /** Cancels the in-flight request. */
  readonly signal?: AbortSignal | undefined
  /** Overrides `message.idempotencyKey` for this call. */
  readonly idempotencyKey?: string | undefined
}

/** The outcome of a send. */
export type SendOutcome = Result<SendResult, EmailError>

/** A transactional email provider. */
export interface EmailProvider {
  /** Stable name, e.g. `"postmark"`. Used in results, errors and logs. */
  readonly name: string
  readonly capabilities: ProviderCapabilities
  /** Hand one message to the provider. Never throws. */
  send(message: EmailMessage, options?: SendOptions): Promise<SendOutcome>
  /**
   * Optional cheap liveness check. Adapters without a side-effect-free endpoint
   * only verify their configuration.
   */
  healthCheck?(options?: { readonly signal?: AbortSignal }): Promise<Result<void, EmailError>>
}

/** The idempotency key that applies to a call: the option wins over the message field. */
export function effectiveIdempotencyKey(
  message: EmailMessage,
  options: SendOptions | undefined,
): string | undefined {
  return options?.idempotencyKey ?? message.idempotencyKey
}

/**
 * Reject, locally and before any request, a message this provider cannot
 * carry. Returns `ok` with the message unchanged when it fits.
 */
export function checkCapabilities(
  provider: string,
  capabilities: ProviderCapabilities,
  message: EmailMessage,
): Result<EmailMessage, EmailError> {
  const recipients = allRecipients(message).length
  if (message.to.length === 0) {
    return err(new EmailError("validation", "message has no recipients", { provider }))
  }
  if (recipients > capabilities.maxRecipients) {
    return err(
      new EmailError(
        "validation",
        `message has ${recipients} recipients; ${provider} accepts at most ${capabilities.maxRecipients}`,
        { provider, details: { recipients, maxRecipients: capabilities.maxRecipients } },
      ),
    )
  }
  if (message.attachments.length > 0 && !capabilities.attachments) {
    return err(
      new EmailError("configuration", `${provider} does not support attachments`, { provider }),
    )
  }
  const max = capabilities.maxAttachmentBytes
  if (max !== undefined) {
    const bytes = attachmentBytes(message)
    if (bytes > max) {
      return err(
        new EmailError(
          "validation",
          `attachments total ${bytes} bytes; ${provider} accepts ${max}`,
          {
            provider,
            details: { bytes, maxAttachmentBytes: max },
          },
        ),
      )
    }
  }
  return ok(message)
}

/** Build a {@link SendResult} stamped with the current time. */
export function sendResult(
  provider: string,
  messageId: string,
  now: Date = new Date(),
): SendResult {
  return { provider, messageId, acceptedAt: now.toISOString() }
}
