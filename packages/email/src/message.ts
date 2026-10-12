/**
 * The provider-neutral message: a zod schema for untrusted input, and the
 * normalized {@link EmailMessage} every provider receives.
 *
 * Parsing does all the work once, at the boundary, so adapters can trust their
 * input:
 *
 * - addresses are parsed and normalized into {@link Address} objects, and every
 *   bad one is reported with its path (`to.2`), not just the first;
 * - at least one `to` recipient and at least one of `html` / `text` are required;
 * - the subject and every header value are free of CR/LF (header injection);
 * - custom header names are RFC 5322 field names and may not override the
 *   headers the provider builds itself (`From`, `To`, `Subject`, ...);
 * - tags are `{ name, value }` of ASCII letters, digits, `_` and `-`, at most
 *   256 characters each (the strictest common rule, Resend's);
 * - attachment content is canonical base64 (a `Uint8Array` is encoded for you),
 *   and its decoded size is recorded so providers can enforce their limits.
 *
 * @example
 * ```ts
 * import { parseMessage } from "@bib/email/message"
 *
 * const r = parseMessage({
 *   from: "Billing <billing@example.com>",
 *   to: ["ada@example.com"],
 *   subject: "Your receipt",
 *   text: "Thanks!",
 *   tags: [{ name: "category", value: "receipt" }],
 * })
 * if (r.ok) r.value.to // [{ email: "ada@example.com" }]
 * else r.error.issues // [{ path: "to.0", message: "..." }, ...]
 * ```
 */

import { bytesToBase64 } from "@bib/shared/encoding"
import { type FieldIssue, ValidationError } from "@bib/shared/errors"
import { err, ok, type Result } from "@bib/shared/result"
import { z } from "zod"
import { type Address, type AddressInput, parseAddress } from "./address.ts"

/** RFC 5322 §2.1.1: a line must not exceed 998 characters. */
export const MAX_SUBJECT_LENGTH = 998
/** RFC 5322 §2.1.1 line limit, applied to each custom header value. */
export const MAX_HEADER_VALUE_LENGTH = 998
/** Resend's limit for tag names and values (the strictest of the supported providers). */
export const MAX_TAG_LENGTH = 256
/** Our own sanity caps. Providers may impose tighter ones through their capabilities. */
export const MAX_TAGS = 50
export const MAX_METADATA_ENTRIES = 50
export const MAX_METADATA_KEY_LENGTH = 256
export const MAX_METADATA_VALUE_LENGTH = 2000
/** Resend's limit for an idempotency key; also used as ours. */
export const MAX_IDEMPOTENCY_KEY_LENGTH = 256

/**
 * Headers every provider builds itself from structured fields. Setting them as
 * custom headers is rejected (SendGrid documents the same list as reserved).
 * Compared case-insensitively.
 */
export const RESERVED_HEADERS: readonly string[] = [
  "bcc",
  "cc",
  "content-transfer-encoding",
  "content-type",
  "date",
  "dkim-signature",
  "from",
  "mime-version",
  "received",
  "reply-to",
  "return-path",
  "sender",
  "subject",
  "to",
  "x-sg-eid",
  "x-sg-id",
]

const RESERVED = new Set(RESERVED_HEADERS)
const TAG_PATTERN = /^[A-Za-z0-9_-]+$/
// RFC 5322 §3.6.8 field-name: printable US-ASCII except ":".
const HEADER_NAME = /^[\x21-\x39\x3b-\x7e]+$/
const LINE_BREAK = /[\r\n]/
const PRINTABLE_ASCII = /^[\x20-\x7e]+$/
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

/** A normalized attachment. `content` is canonical base64. */
export interface Attachment {
  readonly filename: string
  /** Base64 (standard alphabet, padded, no line breaks). */
  readonly content: string
  readonly contentType: string
  /** Set to reference the attachment inline from HTML as `cid:<contentId>`. */
  readonly contentId?: string
  readonly disposition: "attachment" | "inline"
  /** Decoded size in bytes. */
  readonly size: number
}

/** A tag for analytics and webhooks. */
export interface Tag {
  readonly name: string
  readonly value: string
}

/** A validated, normalized message. Construct it with {@link parseMessage}. */
export interface EmailMessage {
  readonly from: Address
  readonly to: readonly Address[]
  readonly cc: readonly Address[]
  readonly bcc: readonly Address[]
  readonly replyTo: readonly Address[]
  readonly subject: string
  readonly html?: string
  readonly text?: string
  readonly attachments: readonly Attachment[]
  readonly tags: readonly Tag[]
  /** Custom headers, names as given (case preserved). */
  readonly headers: Readonly<Record<string, string>>
  /** Opaque key/value data echoed back in webhooks where the provider supports it. */
  readonly metadata: Readonly<Record<string, string>>
  /** Deduplication key. Providers that support it forward it; see `withIdempotency`. */
  readonly idempotencyKey?: string
}

/** An attachment as callers may supply it. */
export interface AttachmentInput {
  readonly filename: string
  /** Base64 string or raw bytes. */
  readonly content: string | Uint8Array
  readonly contentType?: string
  readonly contentId?: string
  readonly disposition?: "attachment" | "inline"
}

/** A message as callers may supply it. */
export interface EmailMessageInput {
  readonly from: AddressInput
  readonly to: AddressInput | readonly AddressInput[]
  readonly cc?: AddressInput | readonly AddressInput[]
  readonly bcc?: AddressInput | readonly AddressInput[]
  readonly replyTo?: AddressInput | readonly AddressInput[]
  readonly subject: string
  readonly html?: string
  readonly text?: string
  readonly attachments?: readonly AttachmentInput[]
  readonly tags?: readonly Tag[]
  readonly headers?: Readonly<Record<string, string>>
  readonly metadata?: Readonly<Record<string, string>>
  readonly idempotencyKey?: string
}

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  csv: "text/csv",
  gif: "image/gif",
  html: "text/html",
  ics: "text/calendar",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  json: "application/json",
  pdf: "application/pdf",
  png: "image/png",
  svg: "image/svg+xml",
  txt: "text/plain",
  webp: "image/webp",
  xml: "application/xml",
  zip: "application/zip",
}

/** Best-effort content type from a filename. Falls back to `application/octet-stream`. */
export function guessContentType(filename: string): string {
  const dot = filename.lastIndexOf(".")
  if (dot < 0) return "application/octet-stream"
  return MIME_BY_EXTENSION[filename.slice(dot + 1).toLowerCase()] ?? "application/octet-stream"
}

/** Decoded byte length of canonical base64. */
export function base64DecodedLength(b64: string): number {
  if (b64.length === 0) return 0
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0
  return (b64.length / 4) * 3 - padding
}

const addressInput = z.union([
  z.string(),
  z.object({ email: z.string(), name: z.string().optional() }),
])
const addressListInput = z.union([addressInput, z.array(addressInput)])
const singleLine = (max: number, label: string) =>
  z
    .string()
    .max(max, `${label} must be at most ${max} characters`)
    .refine((v) => !LINE_BREAK.test(v), `${label} must not contain line breaks`)

/** The zod schema for raw input (shape and string rules). {@link parseMessage} adds normalization. */
export const EmailMessageInputSchema = z
  .object({
    from: addressInput,
    to: addressListInput,
    cc: addressListInput.optional(),
    bcc: addressListInput.optional(),
    replyTo: addressListInput.optional(),
    subject: singleLine(MAX_SUBJECT_LENGTH, "subject").refine(
      (v) => v.trim().length > 0,
      "subject must not be empty",
    ),
    html: z.string().optional(),
    text: z.string().optional(),
    attachments: z
      .array(
        z.object({
          filename: singleLine(255, "filename").refine(
            (v) => v.trim().length > 0 && !/[\\/]/.test(v),
            "filename must be non-empty and contain no path separators",
          ),
          content: z.union([z.string(), z.instanceof(Uint8Array)]),
          contentType: z
            .string()
            .regex(
              /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/,
              "contentType must be type/subtype",
            )
            .optional(),
          contentId: z
            .string()
            .regex(
              /^[\x21-\x3b\x3d\x3f-\x7e]{1,255}$/,
              "contentId must be printable ASCII without <>",
            )
            .optional(),
          disposition: z.enum(["attachment", "inline"]).optional(),
        }),
      )
      .optional(),
    tags: z
      .array(
        z.object({
          name: z
            .string()
            .min(1, "tag name must not be empty")
            .max(MAX_TAG_LENGTH, `tag name must be at most ${MAX_TAG_LENGTH} characters`)
            .regex(TAG_PATTERN, "tag name may contain only ASCII letters, digits, _ and -"),
          value: z
            .string()
            .min(1, "tag value must not be empty")
            .max(MAX_TAG_LENGTH, `tag value must be at most ${MAX_TAG_LENGTH} characters`)
            .regex(TAG_PATTERN, "tag value may contain only ASCII letters, digits, _ and -"),
        }),
      )
      .max(MAX_TAGS, `at most ${MAX_TAGS} tags`)
      .optional(),
    headers: z.record(z.string(), singleLine(MAX_HEADER_VALUE_LENGTH, "header value")).optional(),
    metadata: z
      .record(
        z.string().min(1).max(MAX_METADATA_KEY_LENGTH),
        z.string().max(MAX_METADATA_VALUE_LENGTH),
      )
      .optional(),
    idempotencyKey: z
      .string()
      .min(1)
      .max(MAX_IDEMPOTENCY_KEY_LENGTH)
      .regex(PRINTABLE_ASCII, "idempotencyKey must be printable ASCII")
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (value.html === undefined && value.text === undefined) {
      ctx.addIssue({ code: "custom", path: ["html"], message: "one of html or text is required" })
    }
    if (
      value.html !== undefined &&
      value.text !== undefined &&
      value.html === "" &&
      value.text === ""
    ) {
      ctx.addIssue({ code: "custom", path: ["html"], message: "html and text are both empty" })
    }
    for (const name of Object.keys(value.headers ?? {})) {
      if (!HEADER_NAME.test(name)) {
        ctx.addIssue({ code: "custom", path: ["headers", name], message: "invalid header name" })
      } else if (RESERVED.has(name.toLowerCase())) {
        ctx.addIssue({
          code: "custom",
          path: ["headers", name],
          message: `header "${name}" is set from structured fields and cannot be overridden`,
        })
      }
    }
    if (Object.keys(value.metadata ?? {}).length > MAX_METADATA_ENTRIES) {
      ctx.addIssue({
        code: "custom",
        path: ["metadata"],
        message: `at most ${MAX_METADATA_ENTRIES} metadata entries`,
      })
    }
  })

function pathOf(path: readonly PropertyKey[]): string {
  return path.map((p) => String(p)).join(".")
}

function addressesAt(field: string, input: unknown, issues: FieldIssue[], out: Address[]): void {
  if (input === undefined) return
  const list: unknown[] = Array.isArray(input) ? input : [input]
  list.forEach((item, index) => {
    const parsed = parseAddress(item as AddressInput)
    if (parsed.ok) out.push(parsed.value)
    else
      issues.push({
        path: Array.isArray(input) ? `${field}.${index}` : field,
        message: parsed.error,
      })
  })
}

function normalizeAttachment(
  input: AttachmentInput,
  index: number,
  issues: FieldIssue[],
): Attachment | undefined {
  let content: string
  if (typeof input.content === "string") {
    const stripped = input.content.replace(/\s+/g, "")
    if (!BASE64.test(stripped)) {
      issues.push({ path: `attachments.${index}.content`, message: "content is not valid base64" })
      return undefined
    }
    content = stripped
  } else {
    content = bytesToBase64(input.content)
  }
  const disposition = input.disposition ?? (input.contentId === undefined ? "attachment" : "inline")
  const base = {
    filename: input.filename.trim(),
    content,
    contentType: input.contentType ?? guessContentType(input.filename),
    disposition,
    size: base64DecodedLength(content),
  }
  return input.contentId === undefined ? base : { ...base, contentId: input.contentId }
}

/**
 * Validate and normalize untrusted input. On failure the {@link ValidationError}
 * lists every problem with a dotted path.
 */
export function parseMessage(input: unknown): Result<EmailMessage, ValidationError> {
  const shape = EmailMessageInputSchema.safeParse(input)
  if (!shape.success) {
    const issues = shape.error.issues.map((i) => ({ path: pathOf(i.path), message: i.message }))
    return err(new ValidationError("Invalid email message", issues))
  }
  const raw = shape.data
  const issues: FieldIssue[] = []
  const from: Address[] = []
  const to: Address[] = []
  const cc: Address[] = []
  const bcc: Address[] = []
  const replyTo: Address[] = []
  addressesAt("from", raw.from, issues, from)
  addressesAt("to", raw.to, issues, to)
  addressesAt("cc", raw.cc, issues, cc)
  addressesAt("bcc", raw.bcc, issues, bcc)
  addressesAt("replyTo", raw.replyTo, issues, replyTo)
  if (Array.isArray(raw.to) && raw.to.length === 0) {
    issues.push({ path: "to", message: "at least one recipient is required" })
  }
  const attachments: Attachment[] = []
  ;(raw.attachments ?? []).forEach((a, index) => {
    const normalized = normalizeAttachment(a as AttachmentInput, index, issues)
    if (normalized !== undefined) attachments.push(normalized)
  })
  const sender = from[0]
  if (issues.length > 0 || sender === undefined) {
    return err(new ValidationError("Invalid email message", issues))
  }
  const message: EmailMessage = {
    from: sender,
    to,
    cc,
    bcc,
    replyTo,
    subject: raw.subject,
    ...(raw.html === undefined ? {} : { html: raw.html }),
    ...(raw.text === undefined ? {} : { text: raw.text }),
    attachments,
    tags: (raw.tags ?? []).map((t) => ({ name: t.name, value: t.value })),
    headers: { ...raw.headers },
    metadata: { ...raw.metadata },
    ...(raw.idempotencyKey === undefined ? {} : { idempotencyKey: raw.idempotencyKey }),
  }
  return ok(message)
}

/** Every recipient across `to`, `cc` and `bcc`. */
export function allRecipients(message: EmailMessage): Address[] {
  return [...message.to, ...message.cc, ...message.bcc]
}

/** Total decoded attachment size in bytes. */
export function attachmentBytes(message: EmailMessage): number {
  return message.attachments.reduce((sum, a) => sum + a.size, 0)
}
