/**
 * A provider that writes a log-safe summary instead of sending. For local
 * development and examples; never "fails".
 *
 * By default it prints one JSON line produced by `redactMessage` (masked
 * addresses, body lengths, attachment sizes). Pass `redact: false` to print
 * full addresses and bodies when you need to inspect the rendered email
 * locally, and `write` to send the output somewhere other than stdout.
 *
 * @example
 * ```ts
 * import { createConsoleProvider } from "@bib/email/providers/console"
 *
 * const provider = createConsoleProvider()
 * await provider.send(message) // logs {"provider":"console","messageId":"console-1",...}
 * ```
 */

import { ok, type Result } from "@bib/shared/result"
import type { EmailError } from "../errors.ts"
import type { EmailMessage } from "../message.ts"
import {
  checkCapabilities,
  type EmailProvider,
  effectiveIdempotencyKey,
  type ProviderCapabilities,
  type SendOptions,
  type SendOutcome,
  sendResult,
} from "../provider.ts"
import { redactMessage } from "../redact.ts"

/** Options for {@link createConsoleProvider}. */
export interface ConsoleProviderOptions {
  /** Default `process.stdout`-backed `console.log`. */
  readonly write?: (line: string) => void
  /** Default true: log `redactMessage(message)`. False logs the full message. */
  readonly redact?: boolean
  /** Default `"console"`. */
  readonly name?: string
  /** Clock for `acceptedAt`. */
  readonly now?: () => Date
}

/** Generous limits: the console accepts anything a real provider might. */
export const CONSOLE_CAPABILITIES: ProviderCapabilities = {
  maxRecipients: 1000,
  attachments: true,
  idempotency: true,
  tags: true,
  metadata: true,
  customHeaders: true,
}

/** Create a console provider. Message ids are `<name>-1`, `<name>-2`, ... */
export function createConsoleProvider(options: ConsoleProviderOptions = {}): EmailProvider {
  const name = options.name ?? "console"
  const write = options.write ?? ((line: string) => console.log(line))
  const redact = options.redact ?? true
  let counter = 0

  async function send(message: EmailMessage, sendOptions?: SendOptions): Promise<SendOutcome> {
    const fits = checkCapabilities(name, CONSOLE_CAPABILITIES, message)
    if (!fits.ok) return fits
    counter += 1
    const result = sendResult(name, `${name}-${counter}`, options.now?.() ?? new Date())
    const key = effectiveIdempotencyKey(message, sendOptions)
    write(
      JSON.stringify({
        provider: name,
        messageId: result.messageId,
        ...(key === undefined ? {} : { idempotencyKey: key }),
        message: redact ? redactMessage(message) : message,
      }),
    )
    return ok(result)
  }

  async function healthCheck(): Promise<Result<void, EmailError>> {
    return ok(undefined)
  }

  return { name, capabilities: CONSOLE_CAPABILITIES, send, healthCheck }
}
