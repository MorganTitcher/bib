/**
 * Postmark adapter, implemented with `fetch` (no SDK).
 *
 * API shape verified 2026-10-11 against the official docs:
 * - https://postmarkapp.com/developer/api/email-api
 * - https://postmarkapp.com/developer/api/overview (status and error codes)
 *
 * `POST https://api.postmarkapp.com/email` with `X-Postmark-Server-Token`.
 * Body (PascalCase): `From`, `To` / `Cc` / `Bcc` (comma-separated strings,
 * ≤ 50 recipients combined), `ReplyTo`, `Subject`, `HtmlBody`, `TextBody`,
 * `Tag` (a single string), `Headers` ([{ Name, Value }]), `Metadata` (object),
 * `Attachments` ([{ Name, Content, ContentType, ContentID }]) and
 * `MessageStream`. Success is `200 { MessageID, ErrorCode: 0, ... }`.
 *
 * Postmark has **no idempotency key**: a retry after an ambiguous failure can
 * send twice. `withRetry` therefore does not retry `network` / `timeout` for
 * this provider by default.
 *
 * Mapping notes: Postmark takes one `Tag`, so the first tag's value becomes
 * `Tag` and every tag is also copied into `Metadata` as `tag_<name>`. 422 with
 * `ErrorCode` 406 (inactive recipient) or 300 (invalid email request) is
 * `rejected`; ErrorCode 10 is `authentication`. The documented total message
 * size limit is 10 MB.
 *
 * @example
 * ```ts
 * import { createPostmarkProvider } from "@bib/email/providers/postmark"
 *
 * const postmark = createPostmarkProvider({ serverToken: process.env.POSTMARK_TOKEN ?? "" })
 * ```
 */

import { err, ok, type Result } from "@bib/shared/result"
import { formatAddress } from "../address.ts"
import { EmailError, type EmailErrorKind } from "../errors.ts"
import { errorFromResponse, jsonNumber, jsonString, postJson } from "../http.ts"
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

/** Options for {@link createPostmarkProvider}. */
export interface PostmarkOptions {
  readonly serverToken: string
  /** Default `"outbound"`, Postmark's default transactional stream. */
  readonly messageStream?: string
  /** Default `https://api.postmarkapp.com`. */
  readonly baseUrl?: string
  readonly fetch?: FetchLike
  readonly timeoutMs?: number
}

/** Postmark's documented limits. */
export const POSTMARK_CAPABILITIES: ProviderCapabilities = {
  maxRecipients: 50,
  attachments: true,
  // 10 MB total message size, including the base64-encoded attachments.
  maxAttachmentBytes: 7 * 1024 * 1024,
  idempotency: false,
  tags: true,
  metadata: true,
  customHeaders: true,
}

/** Build the Postmark request body. Exported for inspection and tests. */
export function toPostmarkPayload(
  message: EmailMessage,
  messageStream = "outbound",
): Record<string, unknown> {
  const list = (addresses: EmailMessage["to"]): string =>
    addresses.map((a) => formatAddress(a)).join(", ")
  const body: Record<string, unknown> = {
    From: formatAddress(message.from),
    To: list(message.to),
    Subject: message.subject,
    MessageStream: messageStream,
  }
  if (message.cc.length > 0) body.Cc = list(message.cc)
  if (message.bcc.length > 0) body.Bcc = list(message.bcc)
  if (message.replyTo.length > 0) body.ReplyTo = list(message.replyTo)
  if (message.html !== undefined) body.HtmlBody = message.html
  if (message.text !== undefined) body.TextBody = message.text
  const firstTag = message.tags[0]
  if (firstTag !== undefined) body.Tag = firstTag.value
  const metadata: Record<string, string> = { ...message.metadata }
  for (const tag of message.tags) metadata[`tag_${tag.name}`] = tag.value
  if (Object.keys(metadata).length > 0) body.Metadata = metadata
  const headers = Object.entries(message.headers)
  if (headers.length > 0) body.Headers = headers.map(([Name, Value]) => ({ Name, Value }))
  if (message.attachments.length > 0) {
    body.Attachments = message.attachments.map((a) => ({
      Name: a.filename,
      Content: a.content,
      ContentType: a.contentType,
      ...(a.contentId === undefined ? {} : { ContentID: `cid:${a.contentId}` }),
    }))
  }
  return body
}

function kindFor(status: number, errorCode: number | undefined): EmailErrorKind | undefined {
  if (errorCode === 10) return "authentication"
  if (status === 422) return "rejected"
  if (status === 413 || status === 415) return "rejected"
  return undefined
}

/** Create a Postmark provider. */
export function createPostmarkProvider(options: PostmarkOptions): EmailProvider {
  const name = "postmark"
  const fetchImpl = options.fetch ?? fetch
  const baseUrl = (options.baseUrl ?? "https://api.postmarkapp.com").replace(/\/+$/, "")
  const secrets = [options.serverToken]

  async function send(message: EmailMessage, sendOptions?: SendOptions): Promise<SendOutcome> {
    if (options.serverToken === "") {
      return err(
        new EmailError("configuration", "postmark serverToken is empty", { provider: name }),
      )
    }
    const fits = checkCapabilities(name, POSTMARK_CAPABILITIES, message)
    if (!fits.ok) return fits
    const res = await postJson(fetchImpl, name, {
      url: `${baseUrl}/email`,
      headers: { "x-postmark-server-token": options.serverToken },
      body: toPostmarkPayload(message, options.messageStream),
      secrets,
      signal: sendOptions?.signal,
      timeoutMs: options.timeoutMs,
    })
    if (!res.ok) return res
    const response = res.value
    const errorCode = jsonNumber(response.json, "ErrorCode")
    if (response.status === 200 && (errorCode === undefined || errorCode === 0)) {
      const id = jsonString(response.json, "MessageID")
      if (id === undefined) {
        return err(
          new EmailError("unknown", "postmark accepted the request but returned no MessageID", {
            provider: name,
            httpStatus: response.status,
          }),
        )
      }
      return ok(sendResult(name, id))
    }
    return err(
      errorFromResponse(name, response, {
        secrets,
        kind: kindFor(response.status, errorCode),
        providerCode: errorCode === undefined ? undefined : String(errorCode),
        providerMessage: jsonString(response.json, "Message"),
      }),
    )
  }

  async function healthCheck(): Promise<Result<void, EmailError>> {
    if (options.serverToken === "") {
      return err(
        new EmailError("configuration", "postmark serverToken is empty", { provider: name }),
      )
    }
    return ok(undefined)
  }

  return { name, capabilities: POSTMARK_CAPABILITIES, send, healthCheck }
}
