/**
 * Remove tracking parameters from a URL: every `utm_*`, every registered
 * click ID, and the usual analytics, email and share-tracking parameters.
 * Useful for canonical URLs, share links, logs, and `history.replaceState`
 * after attribution has been captured.
 *
 * Other parameters keep their order and values, and the fragment is kept.
 * Relative URLs stay relative. Input that is not a URL is returned unchanged.
 *
 * With `sensitive: true` it also removes parameters whose names suggest
 * secrets or personal data (`token`, `email`, `password`, `code`, ...), which
 * is what you want before writing a URL to logs or analytics.
 *
 * @example
 * ```ts
 * stripTrackingParams("/pricing?plan=pro&utm_source=x&gclid=1#faq") // "/pricing?plan=pro#faq"
 * ```
 */

import { CLICK_ID_PARAMS } from "./click-ids.ts"

/** Exact parameter names (lowercase) removed besides UTMs and click IDs. */
export const TRACKING_PARAMS: ReadonlySet<string> = new Set([
  "_ga",
  "_gl",
  "_gac",
  "gad_source",
  "gad_campaignid",
  "srsltid",
  "mc_eid",
  "_hsmi",
  "__hssc",
  "__hstc",
  "__hsfp",
  "hsctatracking",
  "igshid",
  "igsh",
  "ref_src",
  "ref_url",
  "vero_id",
  "vero_conv",
  "oly_anon_id",
  "oly_enc_id",
  "wickedid",
  "_kx",
  "ml_subscriber",
  "ml_subscriber_hash",
  "rb_clickid",
  "s_cid",
  "dicbo",
  "spm",
  "raneaid",
  "irgwc",
])

/** Parameter name prefixes removed (lowercase). */
export const TRACKING_PREFIXES: readonly string[] = ["utm_", "mtm_", "pk_", "matomo_", "hsa_"]

/** Names that suggest secrets or personal data. */
export const SENSITIVE_PARAM_PATTERN =
  /(session|token|secret|password|passwd|pwd|api[_-]?key|\bkey\b|e-?mail|\botp\b|signature|\bsig\b|\bcode\b|\bauth\b|\bssn\b|phone)/i

/** Options for {@link stripTrackingParams}. */
export interface StripOptions {
  /** Also remove parameters matching {@link SENSITIVE_PARAM_PATTERN}. */
  readonly sensitive?: boolean
  /** Parameter names to keep even if they match (case-insensitive). */
  readonly keep?: readonly string[]
  /** Extra parameter names to remove (case-insensitive). */
  readonly remove?: readonly string[]
}

/** True when `name` would be removed under `options`. */
export function isTrackingParam(name: string, options: StripOptions = {}): boolean {
  const lower = name.toLowerCase()
  if (options.keep?.some((k) => k.toLowerCase() === lower)) return false
  if (options.remove?.some((r) => r.toLowerCase() === lower)) return true
  if (CLICK_ID_PARAMS.has(lower) || TRACKING_PARAMS.has(lower)) return true
  if (TRACKING_PREFIXES.some((p) => lower.startsWith(p))) return true
  return options.sensitive === true && SENSITIVE_PARAM_PATTERN.test(name)
}

const RELATIVE_BASE = "http://relative.invalid"

/** Return `url` without tracking parameters. See the module docs. */
export function stripTrackingParams(url: string, options: StripOptions = {}): string {
  const trimmed = url.trim()
  if (trimmed === "") return url
  const isAbsolute = /^[a-z][a-z0-9+.-]*:/i.test(trimmed)
  let parsed: URL
  try {
    parsed = isAbsolute ? new URL(trimmed) : new URL(trimmed, RELATIVE_BASE)
  } catch {
    return url
  }
  if (parsed.search === "") return url

  // Rebuild the query from its raw pairs so untouched parameters keep their exact encoding.
  const pairs = parsed.search.slice(1).split("&")
  const kept = pairs.filter((pair) => {
    if (pair === "") return false
    const rawName = pair.split("=", 1)[0] ?? ""
    let name: string
    try {
      name = decodeURIComponent(rawName.replace(/\+/g, " "))
    } catch {
      name = rawName
    }
    return !isTrackingParam(name, options)
  })
  if (kept.length === pairs.length) return url
  parsed.search = kept.length > 0 ? `?${kept.join("&")}` : ""

  if (isAbsolute) return parsed.toString()
  if (trimmed.startsWith("//"))
    return `//${parsed.host}${parsed.pathname}${parsed.search}${parsed.hash}`
  const path = trimmed.startsWith("/") ? parsed.pathname : parsed.pathname.slice(1)
  return `${path}${parsed.search}${parsed.hash}`
}

/** Remove tracking parameters from a `URLSearchParams` in place, returning the removed names. */
export function stripTrackingSearchParams(
  params: URLSearchParams,
  options: StripOptions = {},
): string[] {
  const removed = [...new Set([...params.keys()].filter((k) => isTrackingParam(k, options)))]
  for (const name of removed) params.delete(name)
  return removed
}
