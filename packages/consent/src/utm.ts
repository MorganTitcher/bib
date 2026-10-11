/**
 * Parse and normalize UTM campaign parameters.
 *
 * Normalization:
 * - Parameter names match case-insensitively (`UTM_Source` works).
 * - The first non-blank value wins when a key repeats.
 * - Whitespace collapses, control characters reject the value, and values
 *   are capped at 100 characters without splitting a character.
 * - `source` and `medium` are lowercased, because they drive channel
 *   classification and `Google` and `google` must not be two sources.
 *   `campaign`, `term` and `content` keep their case: they are labels.
 * - Common medium aliases fold to one spelling (`ppc` and `paidsearch` to
 *   `cpc`, `e-mail` to `email`), see {@link MEDIUM_ALIASES}.
 *
 * @example
 * ```ts
 * parseUtm("https://x.test/?utm_source=Google&utm_medium=PPC&utm_campaign=Spring Sale")
 * // { source: "google", medium: "cpc", campaign: "Spring Sale" }
 * ```
 */

import { cleanValue, getParam, type ParamsInput, toSearchParams } from "./internal.ts"

/** Normalized UTM values. Every field is optional; at least one is present. */
export interface UtmParams {
  readonly source?: string
  readonly medium?: string
  readonly campaign?: string
  readonly term?: string
  readonly content?: string
  /** `utm_id`, the campaign id used by GA4 data import. */
  readonly id?: string
  readonly sourcePlatform?: string
  readonly creativeFormat?: string
  readonly marketingTactic?: string
}

/** Field name to query parameter, in a stable order. */
export const UTM_FIELDS: readonly (readonly [keyof UtmParams, string])[] = [
  ["source", "utm_source"],
  ["medium", "utm_medium"],
  ["campaign", "utm_campaign"],
  ["term", "utm_term"],
  ["content", "utm_content"],
  ["id", "utm_id"],
  ["sourcePlatform", "utm_source_platform"],
  ["creativeFormat", "utm_creative_format"],
  ["marketingTactic", "utm_marketing_tactic"],
]

/** Medium spellings folded to a canonical form. */
export const MEDIUM_ALIASES: Readonly<Record<string, string>> = {
  ppc: "cpc",
  paidsearch: "cpc",
  "paid-search": "cpc",
  paid_search: "cpc",
  sem: "cpc",
  "e-mail": "email",
  e_mail: "email",
  newsletter: "email",
  "social-media": "social",
  social_media: "social",
  sm: "social",
  "paid-social": "paid_social",
  paidsocial: "paid_social",
}

const LOWERCASED: ReadonlySet<keyof UtmParams> = new Set(["source", "medium", "sourcePlatform"])

/** Options for {@link parseUtm}. */
export interface ParseUtmOptions {
  /** Maximum length per value. Defaults to 100. */
  readonly maxLength?: number
  /** Set false to keep medium spellings as sent. */
  readonly foldMediumAliases?: boolean
}

/** Parse UTM parameters. Returns `undefined` when none are present. */
export function parseUtm(input: ParamsInput, options: ParseUtmOptions = {}): UtmParams | undefined {
  const params = toSearchParams(input)
  const out: { -readonly [K in keyof UtmParams]?: string } = {}
  for (const [field, param] of UTM_FIELDS) {
    let value = cleanValue(getParam(params, param), options.maxLength)
    if (value === undefined) continue
    if (LOWERCASED.has(field)) value = value.toLowerCase()
    if (field === "medium" && options.foldMediumAliases !== false) {
      value = MEDIUM_ALIASES[value] ?? value
    }
    out[field] = value
  }
  return Object.keys(out).length === 0 ? undefined : out
}

/** True when `input` carries at least one UTM parameter. */
export function hasUtm(input: ParamsInput): boolean {
  return parseUtm(input) !== undefined
}

/**
 * Build a query string from UTM values, for link builders. Keys are emitted
 * in {@link UTM_FIELDS} order and blank values are skipped.
 */
export function formatUtm(utm: UtmParams): string {
  const params = new URLSearchParams()
  for (const [field, param] of UTM_FIELDS) {
    const value = utm[field]
    if (value !== undefined && value.trim() !== "") params.set(param, value)
  }
  return params.toString()
}
