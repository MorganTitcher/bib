/**
 * Resend adapter, implemented with `fetch` (no SDK).
 *
 * API shape verified 2026-10-11 against the official docs:
 * - https://resend.com/docs/api-reference/emails/send-email
 * - https://resend.com/docs/api-reference/errors
 *
 * `POST https://api.resend.com/emails`, `Authorization: Bearer <key>`. Body:
 * `from`, `to` (≤ 50), `cc`, `bcc`, `reply_to`, `subject`, `html`, `text`,
 * `headers` (object), `attachments` ([{ content (base64), filename,
 * content_type, content_id }], ≤ 40 MB after encoding) and `tags`
 * ([{ name, value }]). Success returns `{ id }`.
 *
 * Idempotency: the `Idempotency-Key` header (≤ 256 chars, kept 24 h). A 409
 * `concurrent_idempotent_requests` means the same key is in flight
 * (→ `in_progress`, retryable); `invalid_idempotent_request` means the key was
 * reused with a different payload (→ `idempotency_conflict`).
 *
 * Error mapping beyond the HTTP default: 429 `daily_quota_exceeded` /
 * `monthly_quota_exceeded` → `quota` (not retryable); 403 is
 * `authentication` (it also covers unverified domains and quota-above errors,
 * which no retry fixes). Metadata is not a Resend concept and is dropped.
 *
 * @example
 * ```ts
 * import { createResendProvider } from "@bib/email/providers/resend"
 *
 * const resend = createResendProvider({ apiKey: process.env.RESEND_API_KEY ?? "" })
 * ```
 */

import { err, ok, type Result } from "@bib/shared/result"
import { formatAddress } from "../address.ts"
import { EmailError } from "../errors.ts"
import { errorFromResponse, jsonString, postJson } from "../http.ts"
import type { EmailMessage } from "../message.ts"
import {
  checkCapabilities,
  type EmailProvider,
  effectiveIdempotencyKey,
  type FetchLike,
  type ProviderCapabilities,
  type SendOptions,
  type SendOutcome,
  sendResult,
} from "../provider.ts"

/** Options for {@link createResendProvider}. */
export interface ResendOptions {
  readonly apiKey: string
  /** Default `https://api.resend.com`. */
  readonly baseUrl?: string
  readonly fetch?: FetchLike
  readonly timeoutMs?: number
}

/** Resend's documented limits. */
export const RESEND_CAPABILITIES: ProviderCapabilities = {
  maxRecipients: 50,
  attachments: true,
  // 40 MB after base64; decoded bytes are ~3/4 of that.
  maxAttachmentBytes: 30 * 1024 * 1024,
  idempotency: true,
  tags: true,
  metadata: false,
  customHeaders: true,
}

/** Build the Resend request body. Exported for inspection and tests. */
export function toResendPayload(message: EmailMessage): Record<string, unknown> {
  const body: Record<string, unknown> = {
    from: formatAddress(message.from),
    to: message.to.map((a) => formatAddress(a)),
    subject: message.subject,
  }
  if (message.cc.length > 0) body.cc = message.cc.map((a) => formatAddress(a))
  if (message.bcc.length > 0) body.bcc = message.bcc.map((a) => formatAddress(a))
  if (message.replyTo.length > 0) body.reply_to = message.replyTo.map((a) => formatAddress(a))
  if (message.html !== undefined) body.html = message.html
  if (message.text !== undefined) body.text = message.text
  if (Object.keys(message.headers).length > 0) body.headers = message.headers
  if (message.tags.length > 0)
    body.tags = message.tags.map((t) => ({ name: t.name, value: t.value }))
  if (message.attachments.length > 0) {
    body.attachments = message.attachments.map((a) => ({
      filename: a.filename,
      content: a.content,
      content_type: a.contentType,
      ...(a.contentId === undefined ? {} : { content_id: a.contentId }),
    }))
  }
  return body
}

const QUOTA_NAMES = new Set(["daily_quota_exceeded", "monthly_quota_exceeded"])

/** Create a Resend provider. */
export function createResendProvider(options: ResendOptions): EmailProvider {
  const name = "resend"
  const fetchImpl = options.fetch ?? fetch
  const baseUrl = (options.baseUrl ?? "https://api.resend.com").replace(/\/+$/, "")
  const secrets = [options.apiKey]

  async function send(message: EmailMessage, sendOptions?: SendOptions): Promise<SendOutcome> {
    if (options.apiKey === "") {
      return err(new EmailError("configuration", "resend apiKey is empty", { provider: name }))
    }
    const fits = checkCapabilities(name, RESEND_CAPABILITIES, message)
    if (!fits.ok) return fits
    const headers: Record<string, string> = { authorization: `Bearer ${options.apiKey}` }
    const key = effectiveIdempotencyKey(message, sendOptions)
    if (key !== undefined) headers["idempotency-key"] = key
    const res = await postJson(fetchImpl, name, {
      url: `${baseUrl}/emails`,
      headers,
      body: toResendPayload(message),
      secrets,
      signal: sendOptions?.signal,
      timeoutMs: options.timeoutMs,
    })
    if (!res.ok) return res
    const response = res.value
    if (response.status >= 200 && response.status < 300) {
      const id = jsonString(response.json, "id")
      if (id === undefined) {
        return err(
          new EmailError("unknown", "resend accepted the request but returned no id", {
            provider: name,
            httpStatus: response.status,
          }),
        )
      }
      return ok(sendResult(name, id))
    }
    const code = jsonString(response.json, "name")
    let kind: EmailError["kind"] | undefined
    if (response.status === 429 && code !== undefined && QUOTA_NAMES.has(code)) kind = "quota"
    else if (response.status === 409 && code === "concurrent_idempotent_requests")
      kind = "in_progress"
    else if (response.status === 409 && code === "resource_locked") kind = "in_progress"
    else if (response.status === 409) kind = "idempotency_conflict"
    else if (response.status === 400 && code === "invalid_idempotency_key") kind = "validation"
    return err(
      errorFromResponse(name, response, {
        secrets,
        kind,
        providerCode: code,
        providerMessage: jsonString(response.json, "message"),
      }),
    )
  }

  async function healthCheck(): Promise<Result<void, EmailError>> {
    if (options.apiKey === "") {
      return err(new EmailError("configuration", "resend apiKey is empty", { provider: name }))
    }
    return ok(undefined)
  }

  return { name, capabilities: RESEND_CAPABILITIES, send, healthCheck }
}
