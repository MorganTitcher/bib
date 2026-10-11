/**
 * Email address parsing, validation and formatting.
 *
 * Validation is deliberately pragmatic, not a full RFC 5322 parser: it accepts
 * the dot-atom form every transactional provider accepts (`local@domain.tld`)
 * and rejects the forms they reject or that are almost always typos (quoted
 * local parts, IP-literal domains, consecutive dots, a missing TLD). Every
 * check is length- and character-based; there is no backtracking regex, so
 * hostile input cannot cause catastrophic matching time.
 *
 * CR and LF are rejected everywhere: an address or display name containing a
 * line break is a header-injection attempt.
 *
 * @example
 * ```ts
 * import { parseAddress, formatAddress } from "@bib/email/address"
 *
 * const r = parseAddress('"Ada Lovelace" <Ada@Example.COM>')
 * if (r.ok) formatAddress(r.value) // '"Ada Lovelace" <Ada@example.com>'
 * ```
 */

import { err, ok, type Result } from "@bib/shared/result"

/** A mailbox: an address with an optional display name. */
export interface Address {
  /** `local@domain`. The domain is lowercased; the local part keeps its case. */
  readonly email: string
  readonly name?: string
}

/** What callers may pass where an address is expected. */
export type AddressInput = string | Address

/** RFC 5321 §4.5.3.1.1: local part at most 64 octets. */
export const MAX_LOCAL_PART_LENGTH = 64
/** RFC 5321 §4.5.3.1.3 path limit minus the angle brackets. */
export const MAX_EMAIL_LENGTH = 254
/** Display names longer than this are almost certainly abuse. */
export const MAX_DISPLAY_NAME_LENGTH = 256

// RFC 5322 atext, minus nothing: letters, digits and !#$%&'*+-/=?^_`{|}~
const ATEXT = /^[A-Za-z0-9!#$%&'*+\-/=?^_`{|}~]+$/
const DOMAIN_LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/
const LETTERS_ONLY_TLD = /^[A-Za-z]{2,}$/
const PUNYCODE_TLD = /^xn--[A-Za-z0-9-]+$/
const LINE_BREAK = /[\r\n]/
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point
const CONTROL = /[\u0000-\u001f\u007f]/

function hasControl(value: string): boolean {
  return CONTROL.test(value)
}

/**
 * Why an address is invalid, or `undefined` when it is valid. The reason is
 * written for a developer, not an end user.
 */
export function addressProblem(email: string): string | undefined {
  if (email.length === 0) return "address is empty"
  if (email.length > MAX_EMAIL_LENGTH)
    return `address is longer than ${MAX_EMAIL_LENGTH} characters`
  if (hasControl(email)) return "address contains a control character"
  const at = email.lastIndexOf("@")
  if (at < 0) return "address has no '@'"
  if (at === 0) return "address has no local part"
  if (at === email.length - 1) return "address has no domain"
  const local = email.slice(0, at)
  const domain = email.slice(at + 1)
  if (local.includes("@")) return "address contains more than one @"
  if (local.length > MAX_LOCAL_PART_LENGTH) {
    return `local part is longer than ${MAX_LOCAL_PART_LENGTH} characters`
  }
  if (local.startsWith(".") || local.endsWith(".")) return "local part starts or ends with a dot"
  if (local.includes("..")) return "local part has consecutive dots"
  for (const atom of local.split(".")) {
    if (!ATEXT.test(atom)) return "local part contains a character that needs quoting"
  }
  if (domain.length > 253) return "domain is longer than 253 characters"
  const labels = domain.split(".")
  if (labels.length < 2) return "domain has no top-level domain"
  for (const label of labels) {
    if (label.length === 0) return "domain has an empty label"
    if (label.length > 63) return "domain label is longer than 63 characters"
    if (!DOMAIN_LABEL.test(label)) return "domain label has an invalid character"
  }
  const tld = labels[labels.length - 1] ?? ""
  if (!LETTERS_ONLY_TLD.test(tld) && !PUNYCODE_TLD.test(tld)) {
    return "top-level domain must be letters (or punycode)"
  }
  return undefined
}

/** True when `email` is a bare address this package will send to. */
export function isValidEmail(email: string): boolean {
  return addressProblem(email) === undefined
}

/** Lowercase the domain (case-insensitive by RFC 5321) and leave the local part alone. */
export function normalizeEmail(email: string): string {
  const at = email.lastIndexOf("@")
  if (at < 0) return email.trim()
  return `${email.slice(0, at).trim()}@${email
    .slice(at + 1)
    .trim()
    .toLowerCase()}`
}

function unquoteDisplayName(raw: string): Result<string, string> {
  const trimmed = raw.trim()
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    let out = ""
    const inner = trimmed.slice(1, -1)
    for (let i = 0; i < inner.length; i++) {
      const ch = inner[i]
      if (ch === "\\") {
        const next = inner[i + 1]
        if (next === undefined) return err("display name ends with a lone backslash")
        out += next
        i++
      } else if (ch === '"') {
        return err("display name has an unescaped quote")
      } else {
        out += ch
      }
    }
    return ok(out)
  }
  if (trimmed.includes('"')) return err("display name has an unbalanced quote")
  return ok(trimmed)
}

/**
 * Parse `"email"`, `"Name <email>"` or `"\"Quoted, Name\" <email>"`, or
 * validate an `{ email, name }` object. Returns the normalized address or a
 * reason string.
 *
 * Group syntax, comments and multiple addresses in one string are not
 * supported; pass an array instead.
 */
export function parseAddress(input: AddressInput): Result<Address, string> {
  if (typeof input !== "string") {
    if (typeof input !== "object" || input === null || typeof input.email !== "string") {
      return err("address must be a string or an { email, name } object")
    }
    return buildAddress(input.email, input.name)
  }
  if (LINE_BREAK.test(input)) return err("address contains a line break")
  const value = input.trim()
  if (value.endsWith(">")) {
    const open = value.lastIndexOf("<")
    if (open < 0) return err("address has '>' without '<'")
    const email = value.slice(open + 1, -1)
    const rawName = value.slice(0, open)
    const name = unquoteDisplayName(rawName)
    if (!name.ok) return name
    return buildAddress(email, name.value === "" ? undefined : name.value)
  }
  if (value.includes("<") || value.includes(">"))
    return err("address has unbalanced angle brackets")
  return buildAddress(value, undefined)
}

function buildAddress(email: string, name: string | undefined): Result<Address, string> {
  const normalized = normalizeEmail(email)
  const problem = addressProblem(normalized)
  if (problem !== undefined) return err(problem)
  if (name === undefined) return ok({ email: normalized })
  if (hasControl(name)) return err("display name contains a control character")
  const trimmedName = name.trim()
  if (trimmedName.length > MAX_DISPLAY_NAME_LENGTH) {
    return err(`display name is longer than ${MAX_DISPLAY_NAME_LENGTH} characters`)
  }
  return trimmedName === ""
    ? ok({ email: normalized })
    : ok({ email: normalized, name: trimmedName })
}

/** Options for {@link formatAddress}. */
export interface FormatAddressOptions {
  /**
   * Encode a non-ASCII display name as an RFC 2047 `=?UTF-8?B?...?=` word.
   * Needed when the string goes into a raw MIME header (SES `FromEmailAddress`);
   * JSON APIs that build the header themselves want the plain form. Default false.
   */
  readonly encodeNonAscii?: boolean
}

// RFC 5322 atext plus space: display names made only of these need no quoting.
const PHRASE_SAFE = /^[A-Za-z0-9!#$%&'*+\-/=?^_`{|}~ ]+$/
// biome-ignore lint/suspicious/noControlCharactersInRegex: ASCII range check
const ASCII = /^[\u0000-\u007f]*$/

/** RFC 2047 encoded-word (base64, UTF-8). Long names are split into several words. */
export function encodeHeaderWord(value: string): string {
  const bytes = new TextEncoder().encode(value)
  // 75-char word limit: "=?UTF-8?B?" + "?=" is 12 chars, leaving 63 → 45 bytes of base64 input
  // after rounding down to a multiple of 3. Split on code-point boundaries.
  const words: string[] = []
  let chunk: number[] = []
  const flush = (): void => {
    if (chunk.length > 0) {
      words.push(`=?UTF-8?B?${Buffer.from(chunk).toString("base64")}?=`)
      chunk = []
    }
  }
  let i = 0
  while (i < bytes.length) {
    const lead = bytes[i] ?? 0
    const width = lead < 0x80 ? 1 : lead < 0xe0 ? 2 : lead < 0xf0 ? 3 : 4
    if (chunk.length + width > 45) flush()
    for (let k = 0; k < width && i < bytes.length; k++, i++) chunk.push(bytes[i] ?? 0)
  }
  flush()
  return words.join(" ")
}

/**
 * Render an address as a header value: `email`, `Name <email>` or
 * `"Quoted, Name" <email>`.
 */
export function formatAddress(address: Address, options: FormatAddressOptions = {}): string {
  const name = address.name
  if (name === undefined || name === "") return address.email
  if (options.encodeNonAscii === true && !ASCII.test(name)) {
    return `${encodeHeaderWord(name)} <${address.email}>`
  }
  if (PHRASE_SAFE.test(name)) return `${name} <${address.email}>`
  return `"${name.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}" <${address.email}>`
}

/**
 * Parse one address or a list. Returns every problem with its index, not just
 * the first, so a form can highlight all bad entries at once.
 */
export function parseAddressList(
  input: AddressInput | readonly AddressInput[],
): Result<Address[], { index: number; reason: string }[]> {
  const items: readonly AddressInput[] = Array.isArray(input) ? input : [input as AddressInput]
  const out: Address[] = []
  const problems: { index: number; reason: string }[] = []
  items.forEach((item, index) => {
    const parsed = parseAddress(item)
    if (parsed.ok) out.push(parsed.value)
    else problems.push({ index, reason: parsed.error })
  })
  return problems.length > 0 ? err(problems) : ok(out)
}
