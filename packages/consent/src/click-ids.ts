/**
 * Ad-platform click identifiers: the parameters a platform appends to a
 * landing URL so a later conversion can be tied back to the click. Detection
 * is case-insensitive (Snapchat sends `ScCid`, for example).
 *
 * Each entry names the platform and the channel the click implies. The
 * registry is ordered by precedence: when a URL carries several click IDs,
 * the first registered one is the primary.
 *
 * Deliberately absent: `srsltid` (Google free Shopping listings and organic
 * results, so it is not a paid click) and `igshid` / `si` (share tracking,
 * not ad clicks). `stripTrackingParams` still removes them.
 *
 * @example
 * ```ts
 * primaryClickId("https://example.com/?gclid=abc").platform // "google_ads"
 * ```
 */

import { cleanValue, getParam, type ParamsInput, toSearchParams } from "./internal.ts"

/** Channel a click identifier implies. */
export type ClickIdChannel = "paid_search" | "paid_social" | "display" | "affiliate" | "email"

/** One registered click-ID parameter. */
export interface ClickIdDefinition {
  /** Parameter name, lowercase. */
  readonly param: string
  /** Platform identifier, snake_case. */
  readonly platform: string
  readonly channel: ClickIdChannel
}

/**
 * The registry, in precedence order. Platform names are generic identifiers,
 * not brand claims.
 */
export const CLICK_ID_REGISTRY: readonly ClickIdDefinition[] = [
  // Google Ads: gclid on web; gbraid (app) and wbraid (web) on iOS where gclid is restricted.
  { param: "gclid", platform: "google_ads", channel: "paid_search" },
  { param: "gbraid", platform: "google_ads", channel: "paid_search" },
  { param: "wbraid", platform: "google_ads", channel: "paid_search" },
  { param: "dclid", platform: "google_display", channel: "display" },
  { param: "msclkid", platform: "microsoft_ads", channel: "paid_search" },
  { param: "yclid", platform: "yandex_ads", channel: "paid_search" },
  // Adobe Advertising / Search Ads 360 keyword and click identifiers.
  { param: "s_kwcid", platform: "adobe_ads", channel: "paid_search" },
  { param: "ef_id", platform: "adobe_ads", channel: "paid_search" },
  { param: "fbclid", platform: "meta", channel: "paid_social" },
  { param: "ttclid", platform: "tiktok", channel: "paid_social" },
  { param: "li_fat_id", platform: "linkedin", channel: "paid_social" },
  { param: "twclid", platform: "x", channel: "paid_social" },
  { param: "sccid", platform: "snapchat", channel: "paid_social" },
  { param: "sc_click_id", platform: "snapchat", channel: "paid_social" },
  { param: "epik", platform: "pinterest", channel: "paid_social" },
  { param: "rdt_cid", platform: "reddit", channel: "paid_social" },
  { param: "qclid", platform: "quora", channel: "paid_social" },
  { param: "obclid", platform: "outbrain", channel: "display" },
  { param: "tblci", platform: "taboola", channel: "display" },
  { param: "irclickid", platform: "impact", channel: "affiliate" },
  { param: "cjevent", platform: "cj", channel: "affiliate" },
  { param: "awc", platform: "awin", channel: "affiliate" },
  { param: "sscid", platform: "shareasale", channel: "affiliate" },
  { param: "ranmid", platform: "rakuten", channel: "affiliate" },
  { param: "ransiteid", platform: "rakuten", channel: "affiliate" },
  { param: "clickref", platform: "partnerize", channel: "affiliate" },
  { param: "mc_cid", platform: "mailchimp", channel: "email" },
  { param: "mkt_tok", platform: "marketo", channel: "email" },
  { param: "_hsenc", platform: "hubspot", channel: "email" },
]

/** Lowercase names of every registered click-ID parameter. */
export const CLICK_ID_PARAMS: ReadonlySet<string> = new Set(CLICK_ID_REGISTRY.map((d) => d.param))

/** A click ID found in a URL. */
export interface ClickId extends ClickIdDefinition {
  readonly value: string
}

/** Click IDs are opaque tokens; anything longer or with spaces is not one. */
const MAX_CLICK_ID_LENGTH = 512
const CLICK_ID_VALUE = /^[A-Za-z0-9._~\-+/=%:]+$/

/** Options for {@link extractClickIds}. */
export interface ExtractClickIdOptions {
  /** Use a different registry, e.g. to add an in-house platform. */
  readonly registry?: readonly ClickIdDefinition[]
}

/**
 * Every recognized click ID in `input`, in registry order. Values that are
 * blank, too long or contain characters a click ID never has are skipped.
 */
export function extractClickIds(
  input: ParamsInput,
  options: ExtractClickIdOptions = {},
): ClickId[] {
  const params = toSearchParams(input)
  const found: ClickId[] = []
  for (const def of options.registry ?? CLICK_ID_REGISTRY) {
    const raw = getParam(params, def.param)
    const value = cleanValue(raw, MAX_CLICK_ID_LENGTH)
    if (value === undefined || value !== raw?.trim() || !CLICK_ID_VALUE.test(value)) continue
    found.push({ ...def, value })
  }
  return found
}

/** The highest-precedence click ID in `input`, if any. */
export function primaryClickId(
  input: ParamsInput,
  options: ExtractClickIdOptions = {},
): ClickId | undefined {
  return extractClickIds(input, options)[0]
}
