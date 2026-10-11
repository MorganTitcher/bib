/**
 * The HTTP plumbing shared by the fetch-based adapters, exported so a custom
 * adapter can reuse it.
 *
 * {@link postJson} turns every transport outcome into a `Result`:
 *
 * - the caller's signal firing → `aborted`;
 * - the per-request deadline (`timeoutMs`, default 30 s) → `timeout`;
 * - `fetch` rejecting for any other reason (DNS, reset, TLS) → `network`;
 * - any HTTP response, including 4xx/5xx → `ok(HttpResponse)`. The adapter
 *   decides what a status means, usually via {@link errorFromResponse}.
 *
 * Secrets passed in `secrets` are scrubbed from every error message, so a
 * transport that echoes the request URL or headers into its error text cannot
 * leak a key into logs.
 *
 * @example
 * ```ts
 * import { postJson, errorFromResponse } from "@bib/email/http"
 *
 * const res = await postJson(fetch, "acme", {
 *   url: "https://api.example.com/send",
 *   headers: { authorization: `Bearer ${key}` },
 *   body: { to: "ada@example.com" },
 *   secrets: [key],
 * })
 * if (res.ok && res.value.status >= 400) return err(errorFromResponse("acme", res.value))
 * ```
 */

import { parseRetryAfter } from "@bib/shared/errors"
import { errorMessage, isRecord } from "@bib/shared/guards"
import { err, ok, type Result } from "@bib/shared/result"
import { classifyHttpStatus, EmailError, type EmailErrorKind } from "./errors.ts"
import type { FetchLike } from "./provider.ts"

/** Default per-request deadline. */
export const DEFAULT_TIMEOUT_MS = 30_000
/** Provider error text kept in an error message, after scrubbing. */
export const MAX_ERROR_TEXT = 300

/** A request for {@link postJson} / {@link sendRequest}. */
export interface HttpRequest {
  readonly url: string
  readonly method?: string
  readonly headers: Readonly<Record<string, string>>
  /** A string is sent as-is; anything else is JSON-encoded. `undefined` (or GET/HEAD) sends no body. */
  readonly body: unknown
  readonly signal?: AbortSignal | undefined
  readonly timeoutMs?: number | undefined
  /** Values to scrub from error messages (API keys, tokens). */
  readonly secrets?: readonly string[]
}

/** A response, read fully. `json` is `undefined` when the body is not JSON. */
export interface HttpResponse {
  readonly status: number
  readonly headers: Headers
  readonly text: string
  readonly json: unknown
}

/** Replace every occurrence of each secret with `[redacted]`. Empty secrets are ignored. */
export function scrubSecrets(text: string, secrets: readonly string[] | undefined): string {
  let out = text
  for (const secret of secrets ?? []) {
    if (secret.length >= 4) out = out.split(secret).join("[redacted]")
  }
  return out
}

function isAbortLike(error: unknown, name: string): boolean {
  return isRecord(error) && error.name === name
}

/** POST a JSON body. See the module docs for the outcome mapping. */
export function postJson(
  fetchImpl: FetchLike,
  provider: string,
  request: HttpRequest,
): Promise<Result<HttpResponse, EmailError>> {
  return sendRequest(fetchImpl, provider, {
    ...request,
    headers: { "content-type": "application/json", accept: "application/json", ...request.headers },
  })
}

/** Send a request with any method. Same outcome mapping as {@link postJson}. */
export async function sendRequest(
  fetchImpl: FetchLike,
  provider: string,
  request: HttpRequest,
): Promise<Result<HttpResponse, EmailError>> {
  const caller = request.signal
  if (caller?.aborted) {
    return err(new EmailError("aborted", "send aborted before the request started", { provider }))
  }
  const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const timeout = AbortSignal.timeout(timeoutMs)
  const signal = caller === undefined ? timeout : AbortSignal.any([caller, timeout])
  const method = (request.method ?? "POST").toUpperCase()
  const hasBody = request.body !== undefined && method !== "GET" && method !== "HEAD"
  const body = !hasBody
    ? undefined
    : typeof request.body === "string"
      ? request.body
      : JSON.stringify(request.body)
  let response: Response
  try {
    response = await fetchImpl(request.url, {
      method,
      headers: request.headers,
      signal,
      ...(body === undefined ? {} : { body }),
    })
  } catch (thrown) {
    return err(transportError(provider, thrown, caller, timeout, timeoutMs, request.secrets))
  }
  let text: string
  try {
    text = await response.text()
  } catch (thrown) {
    return err(transportError(provider, thrown, caller, timeout, timeoutMs, request.secrets))
  }
  let json: unknown
  if (text.length > 0) {
    try {
      json = JSON.parse(text)
    } catch {
      json = undefined
    }
  }
  return ok({ status: response.status, headers: response.headers, text, json })
}

function transportError(
  provider: string,
  thrown: unknown,
  caller: AbortSignal | undefined,
  timeout: AbortSignal,
  timeoutMs: number,
  secrets: readonly string[] | undefined,
): EmailError {
  if (caller?.aborted) {
    return new EmailError("aborted", "send aborted", { provider })
  }
  if (timeout.aborted || isAbortLike(thrown, "TimeoutError")) {
    return new EmailError("timeout", `no response from ${provider} within ${timeoutMs} ms`, {
      provider,
    })
  }
  if (isAbortLike(thrown, "AbortError")) {
    return new EmailError("aborted", "send aborted", { provider })
  }
  const message = scrubSecrets(errorMessage(thrown), secrets).slice(0, MAX_ERROR_TEXT)
  return new EmailError("network", `network error talking to ${provider}: ${message}`, { provider })
}

/** Options for {@link errorFromResponse}. */
export interface ResponseErrorOptions {
  /** Override the kind derived from the status. */
  readonly kind?: EmailErrorKind | undefined
  /** The provider's error code or name. */
  readonly providerCode?: string | undefined
  /** The provider's human message, if extracted. Falls back to the raw body. */
  readonly providerMessage?: string | undefined
  readonly secrets?: readonly string[] | undefined
  /** Clock for date-form `Retry-After`. */
  readonly now?: number | undefined
}

/** Build an {@link EmailError} from a non-success response, honouring `Retry-After`. */
export function errorFromResponse(
  provider: string,
  response: HttpResponse,
  options: ResponseErrorOptions = {},
): EmailError {
  const kind = options.kind ?? classifyHttpStatus(response.status)
  const detail = scrubSecrets(options.providerMessage ?? response.text, options.secrets)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_ERROR_TEXT)
  const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"), options.now)
  return new EmailError(
    kind,
    `${provider} responded ${response.status}${detail === "" ? "" : `: ${detail}`}`,
    {
      provider,
      httpStatus: response.status,
      providerCode: options.providerCode,
      retryAfterMs,
    },
  )
}

/** Read a string field from a JSON body, if present. */
export function jsonString(json: unknown, key: string): string | undefined {
  if (!isRecord(json)) return undefined
  const value = json[key]
  return typeof value === "string" ? value : undefined
}

/** Read a number field from a JSON body, if present. */
export function jsonNumber(json: unknown, key: string): number | undefined {
  if (!isRecord(json)) return undefined
  const value = json[key]
  return typeof value === "number" ? value : undefined
}
