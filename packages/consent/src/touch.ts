/**
 * Marketing touches and first-touch / last-touch attribution.
 *
 * A **touch** is one arrival: where the visitor came from (channel, source,
 * medium), the campaign labels, and the click ID if any. {@link buildTouch}
 * derives it from the landing URL and referrer with this precedence:
 *
 * 1. An explicit `utm_medium` (with `utm_source` deciding search vs social).
 * 2. A click ID (`gclid` means paid search even with no UTMs).
 * 3. The referrer (search, social, email, referral).
 * 4. Otherwise `direct`.
 *
 * An **attribution record** keeps the first and last touch. {@link mergeTouch}
 * applies a sliding inactivity window (90 days by default):
 * - A direct visit never overwrites a real source; it only refreshes activity.
 * - Inside the window, a new non-direct touch becomes the last touch. If the
 *   first touch was direct, it also becomes the first touch.
 * - After the window lapses, the next non-direct touch starts a fresh record.
 * - Repeating the same touch (reload, back button) is not a new touch.
 *
 * Storage is injected ({@link AttributionStorage}), so this works with a
 * cookie, `localStorage`, a KV store or a test double. Nothing here reads
 * the DOM. Only record touches when the visitor's consent allows it.
 *
 * @example
 * ```ts
 * const touch = buildTouch({ url: location.href, referrer: document.referrer, now: Date.now() })
 * recordTouch(storage, touch)
 * ```
 */

import { MS_PER_DAY } from "@bib/shared/dates"
import { err, ok, type Result } from "@bib/shared/result"
import { z } from "zod"
import { type ClickIdChannel, primaryClickId } from "./click-ids.ts"
import { cleanValue, parseUrl } from "./internal.ts"
import { type ClassifyReferrerOptions, classifyReferrer, SOCIAL_HOSTS } from "./referrer.ts"
import { parseUtm } from "./utm.ts"

/** Marketing channel of a touch. */
export const CHANNELS = [
  "paid_search",
  "paid_social",
  "display",
  "affiliate",
  "email",
  "organic_search",
  "organic_social",
  "referral",
  "campaign",
  "direct",
] as const

export type Channel = (typeof CHANNELS)[number]

const timestamp = z.number().int().min(0).max(8.64e15)
const shortText = z.string().min(1).max(100)

/** Schema for one touch. */
export const TouchSchema = z.object({
  channel: z.enum(CHANNELS),
  source: shortText,
  medium: shortText,
  campaign: shortText.optional(),
  term: shortText.optional(),
  content: shortText.optional(),
  clickId: z
    .object({
      param: z.string().min(1).max(32),
      value: z.string().min(1).max(512),
      platform: z.string().min(1).max(32),
    })
    .optional(),
  referrerHost: z.string().min(1).max(253).optional(),
  landingPath: z.string().min(1).max(100).optional(),
  at: timestamp,
})

export type Touch = z.infer<typeof TouchSchema>

/** Schema for the stored first/last record. */
export const AttributionRecordSchema = z.object({
  schema: z.literal(1),
  first: TouchSchema,
  last: TouchSchema,
  touchCount: z.number().int().min(1).max(1_000_000),
  /** Last activity of any kind, which the inactivity window runs from. */
  seenAt: timestamp,
})

export type AttributionRecord = z.infer<typeof AttributionRecordSchema>

const CLICK_ID_MEDIUM: Readonly<Record<ClickIdChannel, string>> = {
  paid_search: "cpc",
  paid_social: "paid_social",
  display: "display",
  affiliate: "affiliate",
  email: "email",
}

function isSocialSource(source: string | undefined): boolean {
  if (source === undefined) return false
  return SOCIAL_HOSTS.some(([domain, name]) => name === source || domain === source)
}

/**
 * Map a (normalized, lowercase) `utm_medium` to a channel. `source` breaks
 * ties: `cpc` from a social network is paid social, and `organic` from one is
 * organic social.
 */
export function channelFromMedium(medium: string, source?: string): Channel {
  const social = isSocialSource(source)
  if (/^(?:cpc|ppc|paid|paidsearch|paid_search|sem)$/.test(medium)) {
    return social ? "paid_social" : "paid_search"
  }
  if (/^(?:paid_social|paidsocial|social_paid|social-paid)$/.test(medium)) return "paid_social"
  if (/^(?:display|banner|cpm|cpv|video|programmatic|interstitial)$/.test(medium)) return "display"
  if (/^(?:social|organic_social|social-network|social-media)$/.test(medium))
    return "organic_social"
  if (/^(?:email|e-mail|newsletter)$/.test(medium)) return "email"
  if (/^(?:affiliate|affiliates|partner|partners)$/.test(medium)) return "affiliate"
  if (medium === "organic") return social ? "organic_social" : "organic_search"
  if (medium === "referral") return "referral"
  return "campaign"
}

/** Inputs for {@link buildTouch}. */
export interface BuildTouchInput extends ClassifyReferrerOptions {
  /** The landing URL, absolute. */
  readonly url: string | URL
  readonly referrer?: string | null
  /** Milliseconds since the epoch. */
  readonly now: number
}

/**
 * Derive a touch from a landing URL and referrer. The landing path is kept
 * without its query string, so tokens and personal data in the query are
 * never stored.
 */
export function buildTouch(input: BuildTouchInput): Touch {
  const url = typeof input.url === "string" ? parseUrl(input.url) : input.url
  const utm = url !== undefined ? parseUtm(url) : undefined
  const click = url !== undefined ? primaryClickId(url) : undefined
  const ref = classifyReferrer(input.referrer, input)

  const landingPath = cleanValue(url?.pathname)
  const extras = {
    ...(utm?.campaign !== undefined ? { campaign: utm.campaign } : {}),
    ...(utm?.term !== undefined ? { term: utm.term } : {}),
    ...(utm?.content !== undefined ? { content: utm.content } : {}),
    ...(click !== undefined
      ? { clickId: { param: click.param, value: click.value, platform: click.platform } }
      : {}),
    ...(ref.host !== undefined && ref.type !== "internal" ? { referrerHost: ref.host } : {}),
    ...(landingPath !== undefined ? { landingPath } : {}),
    at: input.now,
  }

  if (utm?.medium !== undefined) {
    const channel = channelFromMedium(utm.medium, utm.source)
    const source = utm.source ?? click?.platform ?? ref.source ?? "(not set)"
    return { channel, source, medium: utm.medium, ...extras }
  }
  if (click !== undefined) {
    return {
      channel: click.channel,
      source: utm?.source ?? click.platform,
      medium: CLICK_ID_MEDIUM[click.channel],
      ...extras,
    }
  }
  if (utm?.source !== undefined) {
    // A source with no medium: a social network is organic social, anything else "campaign".
    const channel: Channel = isSocialSource(utm.source) ? "organic_social" : "campaign"
    return { channel, source: utm.source, medium: "(not set)", ...extras }
  }
  switch (ref.type) {
    case "search":
      return {
        channel: "organic_search",
        source: ref.source ?? "search",
        medium: "organic",
        ...extras,
      }
    case "social":
      return {
        channel: "organic_social",
        source: ref.source ?? "social",
        medium: "social",
        ...extras,
      }
    case "email":
      return { channel: "email", source: ref.source ?? "email", medium: "email", ...extras }
    case "referral":
      return {
        channel: "referral",
        source: ref.source ?? "referral",
        medium: "referral",
        ...extras,
      }
    default:
      if (utm !== undefined) {
        return { channel: "campaign", source: "(not set)", medium: "(not set)", ...extras }
      }
      return { channel: "direct", source: "(direct)", medium: "(none)", ...extras }
  }
}

/** True for touches that carry an acquisition signal (anything but direct). */
export function isSignalTouch(touch: Touch): boolean {
  return touch.channel !== "direct"
}

/** Same arrival repeated: same source, medium, campaign labels and click ID. */
export function isSameTouch(a: Touch, b: Touch): boolean {
  return (
    a.channel === b.channel &&
    a.source === b.source &&
    a.medium === b.medium &&
    a.campaign === b.campaign &&
    a.content === b.content &&
    a.term === b.term &&
    a.clickId?.value === b.clickId?.value
  )
}

/** Options for {@link mergeTouch}. */
export interface MergeOptions {
  /** Inactivity window. Defaults to 90 days. */
  readonly windowMs?: number
  /** Minimum gap between activity-only writes. Defaults to 1 day. */
  readonly refreshThrottleMs?: number
}

/** Result of {@link mergeTouch}. `changed` is false when nothing needs writing. */
export interface MergeResult {
  readonly record: AttributionRecord
  readonly changed: boolean
}

function fresh(touch: Touch): AttributionRecord {
  return { schema: 1, first: touch, last: touch, touchCount: 1, seenAt: touch.at }
}

/** Fold a touch into an existing record. Pure: neither argument is modified. */
export function mergeTouch(
  existing: AttributionRecord | undefined,
  touch: Touch,
  options: MergeOptions = {},
): MergeResult {
  if (existing === undefined) return { record: fresh(touch), changed: true }
  // Out-of-order event (clock skew, replayed queue): never rewrite history with it.
  if (touch.at < existing.seenAt) return { record: existing, changed: false }

  const windowMs = options.windowMs ?? 90 * MS_PER_DAY
  const throttle = options.refreshThrottleMs ?? MS_PER_DAY
  const expired = touch.at - existing.seenAt > windowMs
  const signal = isSignalTouch(touch)

  const refresh = (): MergeResult =>
    touch.at - existing.seenAt >= throttle
      ? { record: { ...existing, seenAt: touch.at }, changed: true }
      : { record: existing, changed: false }

  if (!signal) {
    // An expired record with no real source is replaced by the new direct touch.
    if (expired && !isSignalTouch(existing.first)) return { record: fresh(touch), changed: true }
    return refresh()
  }
  if (expired) return { record: fresh(touch), changed: true }
  if (isSameTouch(existing.last, touch)) return refresh()

  const first = isSignalTouch(existing.first) ? existing.first : touch
  return {
    record: {
      schema: 1,
      first,
      last: touch,
      touchCount: Math.min(existing.touchCount + 1, 1_000_000),
      seenAt: touch.at,
    },
    changed: true,
  }
}

/** Why a stored record could not be read or written. */
export type AttributionStorageError =
  | { readonly kind: "empty" }
  | { readonly kind: "invalid"; readonly message: string }
  | { readonly kind: "too_large"; readonly length: number }

/** Default size cap for a serialized record, leaving room in a 4 KB cookie. */
export const MAX_SERIALIZED_LENGTH = 3_500

/**
 * Serialize a record as percent-encoded JSON (safe as a cookie value). When
 * the result exceeds `maxLength`, optional labels (term, content, landing
 * path) are dropped first; if it is still too large, an error is returned.
 */
export function serializeAttribution(
  record: AttributionRecord,
  maxLength = MAX_SERIALIZED_LENGTH,
): Result<string, AttributionStorageError> {
  const encode = (r: AttributionRecord) => encodeURIComponent(JSON.stringify(r))
  const full = encode(AttributionRecordSchema.parse(record))
  if (full.length <= maxLength) return ok(full)
  const slim = (t: Touch): Touch => {
    const { term: _t, content: _c, landingPath: _l, ...rest } = t
    return rest
  }
  const reduced = encode({ ...record, first: slim(record.first), last: slim(record.last) })
  if (reduced.length <= maxLength) return ok(reduced)
  return err({ kind: "too_large", length: reduced.length })
}

/** Parse a stored record. Accepts percent-encoded or plain JSON. Never throws. */
export function parseAttribution(
  value: string | null | undefined,
): Result<AttributionRecord, AttributionStorageError> {
  if (typeof value !== "string" || value.trim() === "") return err({ kind: "empty" })
  if (value.length > 16_384) return err({ kind: "too_large", length: value.length })
  let json: unknown
  try {
    const text = value.trim().startsWith("{") ? value : decodeURIComponent(value)
    json = JSON.parse(text)
  } catch {
    return err({ kind: "invalid", message: "not JSON" })
  }
  const result = AttributionRecordSchema.safeParse(json)
  if (!result.success) {
    return err({ kind: "invalid", message: result.error.issues.map((i) => i.message).join("; ") })
  }
  const r = result.data
  if (r.first.at > r.last.at || r.last.at > r.seenAt) {
    return err({ kind: "invalid", message: "timestamps out of order" })
  }
  return ok(r)
}

/** Where the record lives. Synchronous on purpose: cookies and localStorage are. */
export interface AttributionStorage {
  get(): string | null | undefined
  set(value: string): void
}

/** Read the stored record, treating anything unreadable as absent. */
export function readAttribution(storage: AttributionStorage): AttributionRecord | undefined {
  const parsed = parseAttribution(storage.get())
  return parsed.ok ? parsed.value : undefined
}

/**
 * Read, merge and write back. Writes only when the record changed, so a
 * reload does not rewrite the cookie. A corrupt stored value is replaced.
 */
export function recordTouch(
  storage: AttributionStorage,
  touch: Touch,
  options: MergeOptions & { readonly maxLength?: number } = {},
): Result<MergeResult, AttributionStorageError> {
  const result = mergeTouch(readAttribution(storage), touch, options)
  if (!result.changed) return ok(result)
  const serialized = serializeAttribution(result.record, options.maxLength)
  if (!serialized.ok) return serialized
  storage.set(serialized.value)
  return ok(result)
}
