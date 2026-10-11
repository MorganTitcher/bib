/**
 * security.txt (RFC 9116): how researchers should report vulnerabilities.
 * Serve it at `/.well-known/security.txt` as `text/plain; charset=utf-8`.
 *
 * `Contact` (one or more) and `Expires` (exactly one, in the future) are
 * required. The RFC recommends an Expires less than a year away so a stale file
 * is noticed; we warn beyond that. Pass `now` explicitly for deterministic output.
 */

import { type DateInput, toInstant } from "./internal.ts"

export interface SecurityTxtInput {
  /** `mailto:`, `https:` or `tel:` URIs, in order of preference. A bare email gets `mailto:`. */
  readonly contact: readonly string[]
  readonly expires: DateInput
  readonly encryption?: readonly string[]
  readonly acknowledgments?: readonly string[]
  /** Canonical URL(s) of this file. */
  readonly canonical?: readonly string[]
  readonly policy?: readonly string[]
  readonly hiring?: readonly string[]
  /** BCP 47 tags, e.g. `["en", "de"]`. */
  readonly preferredLanguages?: readonly string[]
  /** Free-form comment lines emitted at the top, each prefixed with `# `. */
  readonly comments?: readonly string[]
}

export interface SecurityTxtResult {
  readonly path: "/.well-known/security.txt"
  readonly contentType: "text/plain; charset=utf-8"
  readonly body: string
  readonly warnings: readonly string[]
}

const YEAR_MS = 365 * 24 * 60 * 60 * 1000

function normalizeContact(value: string): string {
  const v = value.trim()
  if (/^[^\s@:/]+@[^\s@]+\.[^\s@]+$/.test(v)) return `mailto:${v}`
  return v
}

function checkUri(value: string, field: string, schemes: readonly string[]): string {
  const v = value.trim()
  if (/[\r\n]/.test(v)) throw new RangeError(`${field}: must not contain line breaks`)
  let url: URL
  try {
    url = new URL(v)
  } catch {
    throw new RangeError(`${field}: expected a URI, got "${value}"`)
  }
  if (!schemes.includes(url.protocol))
    throw new RangeError(`${field}: scheme must be one of ${schemes.join(", ")}`)
  return v
}

/**
 * Build a security.txt body. Throws when Contact is missing, a URI is invalid
 * (web URIs must be `https:`), or Expires is not in the future.
 */
export function buildSecurityTxt(
  input: SecurityTxtInput,
  now: DateInput = new Date(),
): SecurityTxtResult {
  const warnings: string[] = []
  if (input.contact.length === 0) throw new RangeError("security.txt requires at least one Contact")
  const expires = toInstant(input.expires, "expires")
  const nowDate = toInstant(now, "now")
  if (expires.getTime() <= nowDate.getTime()) throw new RangeError("Expires must be in the future")
  if (expires.getTime() - nowDate.getTime() > YEAR_MS) {
    warnings.push("Expires is more than a year away; RFC 9116 recommends less than a year")
  }
  const lines: string[] = []
  for (const comment of input.comments ?? []) {
    for (const part of comment.split(/\r?\n/)) lines.push(`# ${part}`.trimEnd())
  }
  const web = ["https:"]
  for (const c of input.contact)
    lines.push(
      `Contact: ${checkUri(normalizeContact(c), "Contact", ["mailto:", "https:", "tel:"])}`,
    )
  lines.push(`Expires: ${expires.toISOString()}`)
  for (const v of input.encryption ?? [])
    lines.push(`Encryption: ${checkUri(v, "Encryption", ["https:", "dns:", "openpgp4fpr:"])}`)
  for (const v of input.acknowledgments ?? [])
    lines.push(`Acknowledgments: ${checkUri(v, "Acknowledgments", web)}`)
  const languages = (input.preferredLanguages ?? []).map((l) => l.trim()).filter(Boolean)
  for (const l of languages) {
    if (!/^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$/.test(l))
      throw new RangeError(`Preferred-Languages: invalid tag "${l}"`)
  }
  if (languages.length > 0) lines.push(`Preferred-Languages: ${languages.join(", ")}`)
  for (const v of input.canonical ?? []) lines.push(`Canonical: ${checkUri(v, "Canonical", web)}`)
  for (const v of input.policy ?? []) lines.push(`Policy: ${checkUri(v, "Policy", web)}`)
  for (const v of input.hiring ?? []) lines.push(`Hiring: ${checkUri(v, "Hiring", web)}`)
  if (
    (input.canonical ?? []).length > 0 &&
    !(input.canonical ?? []).some((c) => c.endsWith("/.well-known/security.txt"))
  ) {
    warnings.push("Canonical usually points at https://<host>/.well-known/security.txt")
  }
  return {
    path: "/.well-known/security.txt",
    contentType: "text/plain; charset=utf-8",
    body: `${lines.join("\n")}\n`,
    warnings,
  }
}
