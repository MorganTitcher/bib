/**
 * Log-safe views of messages and errors.
 *
 * Email carries sensitive content in places a logger will happily print: the
 * body, attachment bytes, recipient addresses, auth-shaped headers and
 * free-form metadata. {@link redactMessage} returns a summary that keeps what
 * an operator needs to debug delivery (provider, counts, sizes, tags, masked
 * recipients) and drops the rest.
 *
 * - Bodies become lengths. Attachments become `{ filename, contentType, size }`.
 * - Addresses are masked (`a***@example.com`) unless `maskAddresses: false`.
 * - Header values whose name looks sensitive (`authorization`, `cookie`,
 *   `token`, `secret`, `key`, `signature`, `password`) become `[redacted]`.
 * - Metadata values are redacted by default (metadata is free-form and often
 *   carries user identifiers); keys are kept. `metadataAllowlist` keeps named
 *   values.
 *
 * @example
 * ```ts
 * import { redactMessage, maskEmail } from "@bib/email/redact"
 *
 * logger.info("email.send", redactMessage(message))
 * maskEmail("ada@example.com") // "a***@example.com"
 * ```
 */

import { scrubSecrets } from "./http.ts"
import type { EmailMessage } from "./message.ts"

/** Replacement for redacted values. */
export const REDACTED = "[redacted]"

const SENSITIVE_NAME =
  /authorization|cookie|token|secret|password|passwd|signature|api[-_]?key|^key$|session/i

/** Whether a header or metadata name looks like it carries a credential. */
export function isSensitiveName(name: string): boolean {
  return SENSITIVE_NAME.test(name)
}

/**
 * Mask the local part of an address, keeping its first character and the
 * domain: `ada@example.com` → `a***@example.com`. A value without `@` is fully
 * masked.
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@")
  if (at <= 0) return "***"
  const first = Array.from(email.slice(0, at))[0] ?? ""
  return `${first}***${email.slice(at)}`
}

/** Options for {@link redactMessage}. */
export interface RedactOptions {
  /** Default true. */
  readonly maskAddresses?: boolean
  /** Metadata keys whose values are safe to log. */
  readonly metadataAllowlist?: readonly string[]
}

/** A log-safe summary of a message. */
export interface RedactedMessage {
  readonly from: string
  readonly to: readonly string[]
  readonly cc: readonly string[]
  readonly bcc: readonly string[]
  readonly replyTo: readonly string[]
  readonly subject: string
  readonly htmlLength?: number
  readonly textLength?: number
  readonly attachments: readonly { filename: string; contentType: string; size: number }[]
  readonly tags: readonly { name: string; value: string }[]
  readonly headers: Readonly<Record<string, string>>
  readonly metadata: Readonly<Record<string, string>>
  readonly idempotencyKey?: string
}

/**
 * Summarize a message for logs. The subject is kept: subjects are templated
 * and useful for debugging. If yours embed sensitive values, drop the field
 * before logging.
 */
export function redactMessage(message: EmailMessage, options: RedactOptions = {}): RedactedMessage {
  const mask = options.maskAddresses ?? true
  const addr = (a: { email: string }): string => (mask ? maskEmail(a.email) : a.email)
  const allow = new Set(options.metadataAllowlist ?? [])
  const headers: Record<string, string> = {}
  for (const [name, value] of Object.entries(message.headers)) {
    headers[name] = isSensitiveName(name) ? REDACTED : value
  }
  const metadata: Record<string, string> = {}
  for (const [key, value] of Object.entries(message.metadata)) {
    metadata[key] = allow.has(key) && !isSensitiveName(key) ? value : REDACTED
  }
  return {
    from: addr(message.from),
    to: message.to.map(addr),
    cc: message.cc.map(addr),
    bcc: message.bcc.map(addr),
    replyTo: message.replyTo.map(addr),
    subject: message.subject,
    ...(message.html === undefined ? {} : { htmlLength: message.html.length }),
    ...(message.text === undefined ? {} : { textLength: message.text.length }),
    attachments: message.attachments.map((a) => ({
      filename: a.filename,
      contentType: a.contentType,
      size: a.size,
    })),
    tags: message.tags.map((t) => ({ name: t.name, value: t.value })),
    headers,
    metadata,
    ...(message.idempotencyKey === undefined ? {} : { idempotencyKey: message.idempotencyKey }),
  }
}

/**
 * Remove every occurrence of the given secrets, and anything that looks like a
 * bearer token or AWS `Credential=`/`Signature=` pair, from free text.
 */
export function redactSecrets(text: string, secrets: readonly string[] = []): string {
  return scrubSecrets(text, secrets)
    .replace(/(bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, `$1${REDACTED}`)
    .replace(/(Credential=)[^,\s]+/g, `$1${REDACTED}`)
    .replace(/(Signature=)[0-9a-f]+/gi, `$1${REDACTED}`)
}
