/**
 * Amazon SES v2 adapter, implemented with `fetch` and SigV4 via `node:crypto`
 * (no AWS SDK).
 *
 * API shape verified 2026-10-11 against the official docs:
 * - https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_SendEmail.html
 * - https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_Message.html
 * - https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_Attachment.html
 * - https://docs.aws.amazon.com/ses/latest/APIReference-V2/CommonErrors.html
 *
 * `POST https://email.<region>.amazonaws.com/v2/email/outbound-emails`, signed
 * with SigV4 (service `ses`). Body: `FromEmailAddress`, `Destination`
 * (`ToAddresses`, `CcAddresses`, `BccAddresses`, ≤ 50 combined),
 * `ReplyToAddresses`, `Content.Simple` (`Subject`, `Body.Html` / `Body.Text`,
 * `Headers`, `Attachments`), `EmailTags` and `ConfigurationSetName`. Success is
 * `200 { MessageId }`.
 *
 * SES has **no idempotency key**. Metadata is not an SES concept and is
 * dropped; tags become `EmailTags`. Error type is read from the
 * `x-amzn-ErrorType` header or the body `__type` / `code`: throttling →
 * `rate_limited`; account-level blocks (`LimitExceededException`,
 * `AccountSuspendedException`, `SendingPausedException`) → `quota`;
 * `MessageRejected` / `BadRequestException` → `rejected`; unverified sender
 * or missing configuration set → `configuration`.
 *
 * Maturity: the signer passes the AWS SigV4 test-suite vectors, and the
 * adapter passes the contract suite against a mocked transport, but it has not
 * been exercised against live SES. `host` is signed but not passed to `fetch`
 * (which sets it itself and may refuse it).
 *
 * @example
 * ```ts
 * import { createSesProvider } from "@bib/email/providers/ses"
 *
 * const ses = createSesProvider({
 *   region: "us-east-1",
 *   credentials: { accessKeyId: "...", secretAccessKey: "..." },
 * })
 * ```
 */

import { errorMessage, isRecord } from "@bib/shared/guards"
import { err, ok, type Result } from "@bib/shared/result"
import { formatAddress } from "../address.ts"
import { EmailError, type EmailErrorKind } from "../errors.ts"
import { errorFromResponse, type HttpResponse, jsonString, sendRequest } from "../http.ts"
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
import { type AwsCredentials, signRequest } from "./sigv4.ts"

/** Options for {@link createSesProvider}. */
export interface SesOptions {
  /** e.g. `"us-east-1"`. */
  readonly region: string
  /** Static credentials, or a resolver called on every request (for rotating STS credentials). */
  readonly credentials: AwsCredentials | (() => Promise<AwsCredentials>)
  readonly configurationSetName?: string
  /** Default `https://email.<region>.amazonaws.com`. */
  readonly baseUrl?: string
  readonly fetch?: FetchLike
  readonly timeoutMs?: number
  /** Signing clock, for tests. */
  readonly now?: () => Date
}

/** SES's documented limits. */
export const SES_CAPABILITIES: ProviderCapabilities = {
  maxRecipients: 50,
  attachments: true,
  // 40 MB total message size after MIME encoding.
  maxAttachmentBytes: 28 * 1024 * 1024,
  idempotency: false,
  tags: true,
  metadata: false,
  customHeaders: true,
}

/** Build the SES v2 request body. Exported for inspection and tests. */
export function toSesPayload(
  message: EmailMessage,
  configurationSetName?: string,
): Record<string, unknown> {
  const fmt = (a: EmailMessage["from"]): string => formatAddress(a, { encodeNonAscii: true })
  const destination: Record<string, unknown> = { ToAddresses: message.to.map(fmt) }
  if (message.cc.length > 0) destination.CcAddresses = message.cc.map(fmt)
  if (message.bcc.length > 0) destination.BccAddresses = message.bcc.map(fmt)
  const bodyPart: Record<string, unknown> = {}
  if (message.html !== undefined) bodyPart.Html = { Data: message.html, Charset: "UTF-8" }
  if (message.text !== undefined) bodyPart.Text = { Data: message.text, Charset: "UTF-8" }
  const simple: Record<string, unknown> = {
    Subject: { Data: message.subject, Charset: "UTF-8" },
    Body: bodyPart,
  }
  const headers = Object.entries(message.headers)
  if (headers.length > 0) simple.Headers = headers.map(([Name, Value]) => ({ Name, Value }))
  if (message.attachments.length > 0) {
    simple.Attachments = message.attachments.map((a) => ({
      FileName: a.filename,
      ContentType: a.contentType,
      ContentDisposition: a.disposition === "inline" ? "INLINE" : "ATTACHMENT",
      ContentTransferEncoding: "BASE64",
      RawContent: a.content,
      ...(a.contentId === undefined ? {} : { ContentId: a.contentId }),
    }))
  }
  const body: Record<string, unknown> = {
    FromEmailAddress: fmt(message.from),
    Destination: destination,
    Content: { Simple: simple },
  }
  if (message.replyTo.length > 0) body.ReplyToAddresses = message.replyTo.map(fmt)
  if (message.tags.length > 0) {
    body.EmailTags = message.tags.map((t) => ({ Name: t.name, Value: t.value }))
  }
  if (configurationSetName !== undefined) body.ConfigurationSetName = configurationSetName
  return body
}

const KIND_FOR_TYPE: Readonly<Record<string, EmailErrorKind>> = {
  TooManyRequestsException: "rate_limited",
  ThrottlingException: "rate_limited",
  LimitExceededException: "quota",
  AccountSuspendedException: "quota",
  SendingPausedException: "quota",
  MessageRejected: "rejected",
  BadRequestException: "rejected",
  MailFromDomainNotVerifiedException: "configuration",
  NotFoundException: "configuration",
  UnrecognizedClientException: "authentication",
  InvalidSignatureException: "authentication",
  AccessDeniedException: "authentication",
}

/** The AWS error type of a response, without the `:http://...` suffix. */
export function sesErrorType(response: HttpResponse): string | undefined {
  const raw =
    response.headers.get("x-amzn-errortype") ??
    jsonString(response.json, "__type") ??
    jsonString(response.json, "code")
  if (raw === undefined) return undefined
  const type = raw.split(":")[0]?.split("#").pop()?.trim()
  return type === undefined || type === "" ? undefined : type
}

function sesErrorMessage(json: unknown): string | undefined {
  if (!isRecord(json)) return undefined
  return jsonString(json, "message") ?? jsonString(json, "Message")
}

/** Create an Amazon SES v2 provider. */
export function createSesProvider(options: SesOptions): EmailProvider {
  const name = "ses"
  const fetchImpl = options.fetch ?? fetch
  const baseUrl = (options.baseUrl ?? `https://email.${options.region}.amazonaws.com`).replace(
    /\/+$/,
    "",
  )

  async function resolveCredentials(): Promise<Result<AwsCredentials, EmailError>> {
    if (options.region === "") {
      return err(new EmailError("configuration", "ses region is empty", { provider: name }))
    }
    let creds: AwsCredentials
    try {
      creds =
        typeof options.credentials === "function"
          ? await options.credentials()
          : options.credentials
    } catch (thrown) {
      return err(
        new EmailError(
          "configuration",
          `ses credentials could not be resolved: ${errorMessage(thrown)}`,
          {
            provider: name,
            cause: thrown,
          },
        ),
      )
    }
    if (creds.accessKeyId === "" || creds.secretAccessKey === "") {
      return err(new EmailError("configuration", "ses credentials are empty", { provider: name }))
    }
    return ok(creds)
  }

  async function signed(
    method: string,
    path: string,
    payload: string,
    creds: AwsCredentials,
    signal: AbortSignal | undefined,
  ): Promise<Result<HttpResponse, EmailError>> {
    const url = `${baseUrl}${path}`
    const baseHeaders: Record<string, string> =
      payload === ""
        ? { accept: "application/json" }
        : { "content-type": "application/json", accept: "application/json" }
    const headers = signRequest(
      {
        method,
        url,
        headers: baseHeaders,
        body: payload,
        region: options.region,
        service: "ses",
        now: options.now?.(),
      },
      creds,
    )
    // `fetch` derives Host from the URL; passing it explicitly can be refused.
    const { host: _host, ...sendHeaders } = headers
    const secrets = [
      creds.secretAccessKey,
      ...(creds.sessionToken === undefined ? [] : [creds.sessionToken]),
    ]
    return sendRequest(fetchImpl, name, {
      url,
      method,
      headers: sendHeaders,
      body: payload === "" ? undefined : payload,
      signal,
      timeoutMs: options.timeoutMs,
      secrets,
    })
  }

  function toError(response: HttpResponse, creds: AwsCredentials): EmailError {
    const type = sesErrorType(response)
    let kind: EmailErrorKind | undefined = type === undefined ? undefined : KIND_FOR_TYPE[type]
    if (kind === undefined && response.status === 403) kind = "authentication"
    return errorFromResponse(name, response, {
      kind,
      providerCode: type,
      providerMessage: sesErrorMessage(response.json),
      secrets: [
        creds.secretAccessKey,
        ...(creds.sessionToken === undefined ? [] : [creds.sessionToken]),
      ],
    })
  }

  async function send(message: EmailMessage, sendOptions?: SendOptions): Promise<SendOutcome> {
    const credsResult = await resolveCredentials()
    if (!credsResult.ok) return credsResult
    const fits = checkCapabilities(name, SES_CAPABILITIES, message)
    if (!fits.ok) return fits
    const creds = credsResult.value
    const payload = JSON.stringify(toSesPayload(message, options.configurationSetName))
    const res = await signed(
      "POST",
      "/v2/email/outbound-emails",
      payload,
      creds,
      sendOptions?.signal,
    )
    if (!res.ok) return res
    const response = res.value
    if (response.status >= 200 && response.status < 300) {
      const id = jsonString(response.json, "MessageId")
      if (id === undefined) {
        return err(
          new EmailError("unknown", "ses accepted the request but returned no MessageId", {
            provider: name,
            httpStatus: response.status,
          }),
        )
      }
      return ok(sendResult(name, id))
    }
    return err(toError(response, creds))
  }

  /** Signed `GET /v2/email/account`: side-effect-free, proves credentials and region. */
  async function healthCheck(opts?: {
    readonly signal?: AbortSignal
  }): Promise<Result<void, EmailError>> {
    const credsResult = await resolveCredentials()
    if (!credsResult.ok) return credsResult
    const res = await signed("GET", "/v2/email/account", "", credsResult.value, opts?.signal)
    if (!res.ok) return res
    if (res.value.status >= 200 && res.value.status < 300) return ok(undefined)
    return err(toError(res.value, credsResult.value))
  }

  return { name, capabilities: SES_CAPABILITIES, send, healthCheck }
}
