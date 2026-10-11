/**
 * The application-facing entry point: validate, then send.
 *
 * `createEmailClient({ provider })` accepts untrusted input (`unknown`), runs
 * {@link parseMessage}, and only hands a well-formed {@link EmailMessage} to
 * the provider. Invalid input returns `err(EmailError("validation"))` with the
 * field issues in `details.issues`; the provider is never called.
 *
 * Compose policy on the provider, outermost first:
 * `withIdempotency(createFallbackProvider([withRetry(a), withRetry(b)]))`.
 *
 * @example
 * ```ts
 * import { createEmailClient } from "@bib/email/client"
 * import { createConsoleProvider } from "@bib/email/providers/console"
 *
 * const email = createEmailClient({ provider: createConsoleProvider(), defaultFrom: "App <no-reply@example.com>" })
 * const outcome = await email.send({ to: "ada@example.com", subject: "Hi", text: "Hello" })
 * if (!outcome.ok) console.error(outcome.error.kind)
 * ```
 */

import { isRecord } from "@bib/shared/guards"
import { err, ok, type Result } from "@bib/shared/result"
import type { AddressInput } from "./address.ts"
import { EmailError } from "./errors.ts"
import { type EmailMessage, parseMessage } from "./message.ts"
import type { EmailProvider, SendOptions, SendOutcome } from "./provider.ts"

/** Options for {@link createEmailClient}. */
export interface EmailClientOptions {
  readonly provider: EmailProvider
  /** Used when the input has no `from`. */
  readonly defaultFrom?: AddressInput
}

/** Validates and sends messages through one provider. */
export interface EmailClient {
  readonly provider: EmailProvider
  /** Validate `input` without sending. */
  validate(input: unknown): Result<EmailMessage, EmailError>
  /** Validate `input`, then send it. Never throws. */
  send(input: unknown, options?: SendOptions): Promise<SendOutcome>
  /** The provider's health check, or `ok` when it has none. */
  healthCheck(options?: { readonly signal?: AbortSignal }): Promise<Result<void, EmailError>>
}

/** Create an {@link EmailClient}. */
export function createEmailClient(options: EmailClientOptions): EmailClient {
  const { provider, defaultFrom } = options

  function validate(input: unknown): Result<EmailMessage, EmailError> {
    const withFrom =
      defaultFrom !== undefined && isRecord(input) && input.from === undefined
        ? { ...input, from: defaultFrom }
        : input
    const parsed = parseMessage(withFrom)
    if (parsed.ok) return parsed
    return err(
      new EmailError("validation", parsed.error.message, {
        provider: provider.name,
        cause: parsed.error,
        details: { issues: parsed.error.issues },
      }),
    )
  }

  async function send(input: unknown, sendOptions?: SendOptions): Promise<SendOutcome> {
    const message = validate(input)
    if (!message.ok) return message
    try {
      return await provider.send(message.value, sendOptions)
    } catch (thrown) {
      // Providers must not throw; a custom one that does still yields a Result.
      return err(
        new EmailError("unknown", "provider threw instead of returning a result", {
          provider: provider.name,
          cause: thrown,
        }),
      )
    }
  }

  async function healthCheck(opts?: {
    readonly signal?: AbortSignal
  }): Promise<Result<void, EmailError>> {
    if (provider.healthCheck === undefined) return ok(undefined)
    return provider.healthCheck(opts)
  }

  return { provider, validate, send, healthCheck }
}
