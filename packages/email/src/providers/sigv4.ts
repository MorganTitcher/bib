/**
 * AWS Signature Version 4 request signing with `node:crypto`, for the SES
 * adapter (no AWS SDK).
 *
 * Algorithm verified 2026-10-11 against the official docs:
 * - https://docs.aws.amazon.com/IAM/latest/UserGuide/create-signed-request.html
 * - https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_sigv-signing-elements.html
 *
 * 1. Canonical request: `METHOD \n URI \n QUERY \n HEADERS \n SIGNED_HEADERS \n
 *    hex(sha256(payload))`. Path segments are URI-encoded twice (every service
 *    except S3); query parameters are encoded and sorted; header names are
 *    lowercased, values trimmed with inner whitespace collapsed, then sorted.
 * 2. String to sign: `AWS4-HMAC-SHA256 \n <amz-date> \n
 *    <yyyymmdd>/<region>/<service>/aws4_request \n hex(sha256(canonical))`.
 * 3. Signing key: HMAC chain `"AWS4" + secret` → date → region → service →
 *    `"aws4_request"`. Signature is lowercase hex HMAC of the string to sign.
 *
 * Tested against the AWS signature test-suite vectors (`get-vanilla`,
 * `post-vanilla`, `get-vanilla-query-order-key-case`) and the documented
 * signing-key derivation example.
 *
 * @example
 * ```ts
 * import { signRequest } from "@bib/email/providers/sigv4"
 *
 * const headers = signRequest(
 *   { method: "POST", url, headers: { "content-type": "application/json" }, body, region: "us-east-1", service: "ses" },
 *   { accessKeyId, secretAccessKey },
 * )
 * await fetch(url, { method: "POST", headers, body })
 * ```
 */

import { createHash, createHmac } from "node:crypto"

/** AWS credentials. `sessionToken` is required for temporary (STS) credentials. */
export interface AwsCredentials {
  readonly accessKeyId: string
  readonly secretAccessKey: string
  readonly sessionToken?: string | undefined
}

/** The request to sign. */
export interface SignableRequest {
  readonly method: string
  readonly url: string
  /** Headers to sign and send. `host` is added from the URL when absent. */
  readonly headers: Readonly<Record<string, string>>
  readonly body: string
  readonly region: string
  readonly service: string
  /** Signing time. Default now. */
  readonly now?: Date | undefined
}

const ALGORITHM = "AWS4-HMAC-SHA256"

function sha256Hex(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex")
}

function hmac(key: string | Buffer, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest()
}

/**
 * RFC 3986 encoding as SigV4 requires: unreserved characters
 * (`A-Z a-z 0-9 - . _ ~`) stay as-is, everything else becomes `%XX` with
 * uppercase hex.
 */
export function uriEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  )
}

/** `20150830T123600Z` form. */
export function amzDate(date: Date): string {
  return date
    .toISOString()
    .replace(/[:-]/g, "")
    .replace(/\.\d{3}/, "")
}

/** Derive the signing key (exposed for verification against AWS's documented example). */
export function deriveSigningKey(
  secretAccessKey: string,
  dateStamp: string,
  region: string,
  service: string,
): Buffer {
  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp)
  const kRegion = hmac(kDate, region)
  const kService = hmac(kRegion, service)
  return hmac(kService, "aws4_request")
}

function canonicalUri(pathname: string): string {
  if (pathname === "" || pathname === "/") return "/"
  // URL already percent-encoded each segment once; encoding again gives the
  // double encoding non-S3 services expect.
  return pathname
    .split("/")
    .map((segment) => uriEncode(segment))
    .join("/")
}

function canonicalQuery(search: URLSearchParams): string {
  const pairs: [string, string][] = []
  for (const [k, v] of search) pairs.push([uriEncode(k), uriEncode(v)])
  pairs.sort(([ak, av], [bk, bv]) => (ak < bk ? -1 : ak > bk ? 1 : av < bv ? -1 : av > bv ? 1 : 0))
  return pairs.map(([k, v]) => `${k}=${v}`).join("&")
}

/** The pieces of a signature, exposed for debugging and tests. */
export interface SignatureParts {
  readonly canonicalRequest: string
  readonly stringToSign: string
  readonly signedHeaders: string
  readonly signature: string
  readonly credentialScope: string
}

/** Compute the signature without producing headers. */
export function computeSignature(
  request: SignableRequest,
  credentials: AwsCredentials,
): SignatureParts {
  const url = new URL(request.url)
  const date = amzDate(request.now ?? new Date())
  const dateStamp = date.slice(0, 8)
  const headers = new Map<string, string>()
  for (const [name, value] of Object.entries(request.headers)) {
    headers.set(name.toLowerCase(), value.trim().replace(/\s+/g, " "))
  }
  if (!headers.has("host")) headers.set("host", url.host)
  headers.set("x-amz-date", date)
  if (credentials.sessionToken !== undefined) {
    headers.set("x-amz-security-token", credentials.sessionToken)
  }
  const names = [...headers.keys()].sort()
  const canonicalHeaders = names.map((n) => `${n}:${headers.get(n) ?? ""}\n`).join("")
  const signedHeaders = names.join(";")
  const canonicalRequest = [
    request.method.toUpperCase(),
    canonicalUri(url.pathname),
    canonicalQuery(url.searchParams),
    canonicalHeaders,
    signedHeaders,
    sha256Hex(request.body),
  ].join("\n")
  const credentialScope = `${dateStamp}/${request.region}/${request.service}/aws4_request`
  const stringToSign = [ALGORITHM, date, credentialScope, sha256Hex(canonicalRequest)].join("\n")
  const key = deriveSigningKey(
    credentials.secretAccessKey,
    dateStamp,
    request.region,
    request.service,
  )
  const signature = createHmac("sha256", key).update(stringToSign, "utf8").digest("hex")
  return { canonicalRequest, stringToSign, signedHeaders, signature, credentialScope }
}

/**
 * Sign a request. Returns the full header set to send: the input headers plus
 * `host`, `x-amz-date`, `x-amz-security-token` (when present) and
 * `authorization`.
 */
export function signRequest(
  request: SignableRequest,
  credentials: AwsCredentials,
): Record<string, string> {
  const url = new URL(request.url)
  const date = amzDate(request.now ?? new Date())
  const parts = computeSignature(
    { ...request, now: request.now ?? parseAmzDate(date) },
    credentials,
  )
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(request.headers)) out[name.toLowerCase()] = value
  if (out.host === undefined) out.host = url.host
  out["x-amz-date"] = date
  if (credentials.sessionToken !== undefined) out["x-amz-security-token"] = credentials.sessionToken
  out.authorization = `${ALGORITHM} Credential=${credentials.accessKeyId}/${parts.credentialScope}, SignedHeaders=${parts.signedHeaders}, Signature=${parts.signature}`
  return out
}

function parseAmzDate(value: string): Date {
  const iso = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(9, 11)}:${value.slice(11, 13)}:${value.slice(13, 15)}Z`
  return new Date(iso)
}
