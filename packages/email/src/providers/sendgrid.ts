/**
 * SendGrid (Twilio) adapter, implemented with `fetch` (no SDK).
 *
 * API shape verified 2026-10-11 against the official docs:
 * - https://www.twilio.com/docs/sendgrid/api-reference/mail-send/mail-send
 * - https://www.twilio.com/docs/sendgrid/glossary/x-message-id
 *
 * `POST https://api.sendgrid.com/v3/mail/send` (EU subusers:
 * `https://api.eu.sendgrid.com`), `Authorization: Bearer <key>`. Body:
 * `personalizations` ([{ to, cc, bcc }] with `{ email, name }` objects),
 * `from`, `reply_to` / `reply_to_list`, `subject`, `content`
 * ([{ type, value }], `text/plain` first), `attachments`
 * ([{ content, filename, type, disposition, content_id }]), `headers`,
 * `categories` (≤ 10, each ≤ 255 chars) and `custom_args`. Success is
 * `202 Accepted` with an empty body; the id is in the `X-Message-ID` header.
 *
 * SendGrid has **no idempotency key**. If `X-Message-ID` is missing on a 202
 * the result's `messageId` is `""` rather than an error: the message was
 * accepted.
 *
 * Mapping notes: tags become `categories` (the tag value; at most 10 are
 * forwarded, the rest dropped) and are also copied into `custom_args` as
 * `tag_<name>`, alongside metadata. The documented total message size limit is
 * 30 MB. Errors carry `{ errors: [{ message, field }] }`; the first message is
 * surfaced.
 *
 * @example
 * ```ts
 * import { createSendGridProvider } from "@bib/email/providers/sendgrid"
 *
 * const sendgrid = createSendGridProvider({ apiKey: process.env.SENDGRID_API_KEY ?? "" })
 * ```
 */

import { isRecord } from "@bib/shared/guards"
import { err, ok, type Result } from "@bib/shared/result"
import type { Address } from "../address.ts"
import { EmailError } from "../errors.ts"
import { errorFromResponse, postJson } from "../http.ts"
import type { EmailMessage } from "../message.ts"
import {
  checkCapabilities,
  type EmailProvider,
  type FetchLike,
  type ProviderCapabilities,
  type SendOptions,
  type SendOutcome,
  sendResult,
} from "../provider.ts"

/** Options for {@link createSendGridProvider}. */
export interface SendGridOptions {
  readonly apiKey: string
  /** Default `https://api.sendgrid.com`. Use `https://api.eu.sendgrid.com` for EU subusers. */
  readonly baseUrl?: string
  readonly fetch?: FetchLike
  readonly timeoutMs?: number
}

/** SendGrid's documented limits (1000 is per personalization; one is used per message). */
export const SENDGRID_CAPABILITIES: ProviderCapabilities = {
  maxRecipients: 1000,
  attachments: true,
  // 30 MB total message size, including the base64-encoded attachments.
  maxAttachmentBytes: 20 * 1024 * 1024,
  idempotency: false,
  tags: true,
  metadata: true,
  customHeaders: true,
}

/** SendGrid's documented maximum number of categories per message. */
export const SENDGRID_MAX_CATEGORIES = 10

function toAddress(a: Address): { email: string; name?: string } {
  return a.name === undefined ? { email: a.email } : { email: a.email, name: a.name }
}

/** Build the SendGrid request body. Exported for inspection and tests. */
export function toSendGridPayload(message: EmailMessage): Record<string, unknown> {
  const personalization: Record<string, unknown> = { to: message.to.map(toAddress) }
  if (message.cc.length > 0) personalization.cc = message.cc.map(toAddress)
  if (message.bcc.length > 0) personalization.bcc = message.bcc.map(toAddress)
  const content: { type: string; value: string }[] = []
  if (message.text !== undefined) content.push({ type: "text/plain", value: message.text })
  if (message.html !== undefined) content.push({ type: "text/html", value: message.html })
  const body: Record<string, unknown> = {
    personalizations: [personalization],
    from: toAddress(message.from),
    subject: message.subject,
    content,
  }
  const [firstReplyTo] = message.replyTo
  if (message.replyTo.length === 1 && firstReplyTo !== undefined)
    body.reply_to = toAddress(firstReplyTo)
  else if (message.replyTo.length > 1) body.reply_to_list = message.replyTo.map(toAddress)
  if (Object.keys(message.headers).length > 0) body.headers = message.headers
  if (message.tags.length > 0) {
    body.categories = [...new Set(message.tags.map((t) => t.value))].slice(
      0,
      SENDGRID_MAX_CATEGORIES,
    )
  }
  const customArgs: Record<string, string> = { ...message.metadata }
  for (const tag of message.tags) customArgs[`tag_${tag.name}`] = tag.value
  if (Object.keys(customArgs).length > 0) body.custom_args = customArgs
  if (message.attachments.length > 0) {
    body.attachments = message.attachments.map((a) => ({
      content: a.content,
      filename: a.filename,
      type: a.contentType,
      disposition: a.disposition,
      ...(a.contentId === undefined ? {} : { content_id: a.contentId }),
    }))
  }
  return body
}

function firstErrorMessage(json: unknown): string | undefined {
  if (!isRecord(json) || !Array.isArray(json.errors)) return undefined
  const first: unknown = json.errors[0]
  if (!isRecord(first) || typeof first.message !== "string") return undefined
  return typeof first.field === "string" ? `${first.field}: ${first.message}` : first.message
}

/** Create a SendGrid provider. */
export function createSendGridProvider(options: SendGridOptions): EmailProvider {
  const name = "sendgrid"
  const fetchImpl = options.fetch ?? fetch
  const baseUrl = (options.baseUrl ?? "https://api.sendgrid.com").replace(/\/+$/, "")
  const secrets = [options.apiKey]

  async function send(message: EmailMessage, sendOptions?: SendOptions): Promise<SendOutcome> {
    if (options.apiKey === "") {
      return err(new EmailError("configuration", "sendgrid apiKey is empty", { provider: name }))
    }
    const fits = checkCapabilities(name, SENDGRID_CAPABILITIES, message)
    if (!fits.ok) return fits
    const res = await postJson(fetchImpl, name, {
      url: `${baseUrl}/v3/mail/send`,
      headers: { authorization: `Bearer ${options.apiKey}` },
      body: toSendGridPayload(message),
      secrets,
      signal: sendOptions?.signal,
      timeoutMs: options.timeoutMs,
    })
    if (!res.ok) return res
    const response = res.value
    if (response.status >= 200 && response.status < 300) {
      return ok(sendResult(name, response.headers.get("x-message-id") ?? ""))
    }
    return err(
      errorFromResponse(name, response, {
        secrets,
        providerMessage: firstErrorMessage(response.json),
      }),
    )
  }

  async function healthCheck(): Promise<Result<void, EmailError>> {
    if (options.apiKey === "") {
      return err(new EmailError("configuration", "sendgrid apiKey is empty", { provider: name }))
    }
    return ok(undefined)
  }

  return { name, capabilities: SENDGRID_CAPABILITIES, send, healthCheck }
}
