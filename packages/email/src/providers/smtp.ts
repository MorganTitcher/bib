/**
 * SMTP adapter — **scaffold**. Every send returns a `configuration` error.
 *
 * A correct SMTP client needs MIME assembly (multipart/alternative and
 * multipart/mixed, quoted-printable / base64 transfer encodings, RFC 2047
 * headers), STARTTLS / implicit TLS, AUTH mechanisms, pipelining, dot-stuffing
 * and per-recipient reply handling. That is what `nodemailer` provides; it is
 * not a dependency of this package yet, and hand-rolling it here would be a
 * worse, less-tested copy.
 *
 * The options type and factory are fixed now so callers can wire SMTP into a
 * fallback chain; once `nodemailer` is added the factory will create a
 * transport with `nodemailer.createTransport({ host, port, secure, auth })`
 * and map `responseCode` 4xx → `unavailable` (retryable), 5xx → `rejected`.
 * Reference: https://nodemailer.com/smtp/ (checked 2026-10-11).
 *
 * @example
 * ```ts
 * import { createSmtpProvider } from "@bib/email/providers/smtp"
 *
 * const smtp = createSmtpProvider({ host: "smtp.example.com", port: 587 })
 * const r = await smtp.send(message) // err(EmailError kind "configuration")
 * ```
 */

import { err, type Result } from "@bib/shared/result"
import { EmailError } from "../errors.ts"
import type { EmailMessage } from "../message.ts"
import type { EmailProvider, ProviderCapabilities, SendOptions, SendOutcome } from "../provider.ts"

/** Options for {@link createSmtpProvider}. */
export interface SmtpOptions {
  readonly host: string
  /** 587 (STARTTLS) or 465 (implicit TLS). */
  readonly port: number
  /** True for implicit TLS (port 465). */
  readonly secure?: boolean
  readonly auth?: { readonly user: string; readonly pass: string }
}

/** Capabilities the eventual implementation will declare. */
export const SMTP_CAPABILITIES: ProviderCapabilities = {
  maxRecipients: 100,
  attachments: true,
  idempotency: false,
  tags: false,
  metadata: false,
  customHeaders: true,
}

const NOT_IMPLEMENTED = "smtp provider is a scaffold: add the nodemailer dependency to enable it"

/** Create the SMTP scaffold. */
export function createSmtpProvider(options: SmtpOptions): EmailProvider {
  const name = "smtp"
  const error = (): EmailError =>
    new EmailError("configuration", NOT_IMPLEMENTED, {
      provider: name,
      details: { host: options.host, port: options.port },
    })

  async function send(_message: EmailMessage, _options?: SendOptions): Promise<SendOutcome> {
    return err(error())
  }

  async function healthCheck(): Promise<Result<void, EmailError>> {
    return err(error())
  }

  return { name, capabilities: SMTP_CAPABILITIES, send, healthCheck }
}
