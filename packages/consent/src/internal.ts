/**
 * Small helpers shared by the attribution modules. Not exported from the
 * package: they are implementation details, not API.
 */

import { normalizeWhitespace, truncate } from "@bib/shared/strings"

/** Default cap for a captured attribution value, in graphemes. */
export const MAX_VALUE_LENGTH = 100

/** Anything a caller may pass where query parameters are expected. */
export type ParamsInput = string | URL | URLSearchParams | Readonly<Record<string, string>>

// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/u

/**
 * Turn any supported input into `URLSearchParams`. A string may be a full URL,
 * a path with a query (`/a?b=c`) or a bare query (`?b=c` or `b=c`). Input that
 * cannot be parsed yields empty params rather than throwing.
 */
export function toSearchParams(input: ParamsInput): URLSearchParams {
  if (input instanceof URLSearchParams) return input
  if (input instanceof URL) return input.searchParams
  if (typeof input !== "string") return new URLSearchParams(input)
  const trimmed = input.trim()
  const queryStart = trimmed.indexOf("?")
  if (queryStart === -1) {
    // A URL or path without `?` has no params. Anything else is a bare query.
    if (trimmed.startsWith("/") || /^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
      return new URLSearchParams()
    }
    return new URLSearchParams(stripHash(trimmed))
  }
  return new URLSearchParams(stripHash(trimmed.slice(queryStart + 1)))
}

function stripHash(query: string): string {
  const hash = query.indexOf("#")
  return hash === -1 ? query : query.slice(0, hash)
}

/**
 * Look a parameter up case-insensitively and return its first non-blank value.
 * Ad platforms are inconsistent about case (`ScCid`, `UTM_Source`).
 */
export function getParam(params: URLSearchParams, name: string): string | undefined {
  const wanted = name.toLowerCase()
  for (const [key, value] of params) {
    if (key.toLowerCase() !== wanted) continue
    if (value.trim() !== "") return value
  }
  return undefined
}

/**
 * Clean a captured value: collapse whitespace, reject control characters, and
 * cap the length without splitting a character. Returns `undefined` for
 * values that end up empty.
 */
export function cleanValue(
  value: string | undefined,
  maxLength = MAX_VALUE_LENGTH,
): string | undefined {
  if (value === undefined) return undefined
  if (CONTROL_CHARS.test(value)) return undefined
  const collapsed = normalizeWhitespace(value)
  if (collapsed === "") return undefined
  return truncate(collapsed, maxLength, "")
}

/**
 * Normalize a hostname: lowercase, drop a trailing dot and a leading `www.`.
 * Returns `undefined` when the input does not look like a hostname.
 */
export function normalizeHost(host: string | undefined): string | undefined {
  if (host === undefined) return undefined
  let h = host.trim().toLowerCase()
  if (h.endsWith(".")) h = h.slice(0, -1)
  if (h.startsWith("www.")) h = h.slice(4)
  if (h === "" || h.length > 253) return undefined
  if (!/^[a-z0-9.-]+$/.test(h) && !/^\[[0-9a-f:.]+\]$/.test(h)) return undefined
  return h
}

/** True when `host` equals `domain` or is a subdomain of it. Never a bare suffix match. */
export function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`)
}

/** Parse a URL, returning `undefined` instead of throwing. */
export function parseUrl(value: string): URL | undefined {
  try {
    return new URL(value)
  } catch {
    return undefined
  }
}
