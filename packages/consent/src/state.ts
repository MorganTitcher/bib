/**
 * The consent record: which categories a visitor allows, under which policy
 * version, since when, and why. Serializes to a short cookie-safe string and
 * back, validated by a zod schema so a tampered or stale cookie is rejected
 * rather than trusted.
 *
 * Categories:
 * - `necessary`: always true. Security, load balancing, the consent cookie itself.
 * - `functional`: preferences such as language or layout.
 * - `analytics`: first-party measurement.
 * - `advertising`: ad storage, ad measurement and remarketing.
 * - `personalization`: content personalization beyond strict function.
 *
 * `doNotSellOrShare` is separate from `advertising` on purpose: under US state
 * laws it is an opt-out of sale/sharing that can coexist with first-party
 * analytics consent. Global Privacy Control sets it.
 *
 * @example
 * ```ts
 * const state = createConsentState({ model: "opt-in", policyVersion: "2026-01", now: 0 })
 * const cookie = serializeConsent(updateConsent(state, { analytics: true }, { now: 1000 }))
 * parseConsent(cookie) // { ok: true, value: { ...categories.analytics: true } }
 * ```
 */

import { err, ok, type Result } from "@bib/shared/result"
import { z } from "zod"
import type { ConsentModel } from "./region.ts"

/** The non-essential categories a visitor can toggle. */
export const CONSENT_CATEGORIES = [
  "functional",
  "analytics",
  "advertising",
  "personalization",
] as const

export type ConsentCategory = (typeof CONSENT_CATEGORIES)[number]

/** Category choices. `necessary` is always present and always true. */
export type ConsentCategories = { readonly necessary: true } & Readonly<
  Record<ConsentCategory, boolean>
>

/** How the current choice came about. */
export const CONSENT_SOURCES = ["default", "banner", "gpc", "api"] as const

export type ConsentSource = (typeof CONSENT_SOURCES)[number]

/** Policy versions are short tokens so they fit in a cookie unescaped. */
const POLICY_VERSION = /^[A-Za-z0-9._-]{1,32}$/

/** Largest millisecond timestamp a `Date` can hold. */
const MAX_TIMESTAMP = 8.64e15

const timestamp = z.number().int().min(0).max(MAX_TIMESTAMP)

/** Schema for a consent record. Exported so callers can validate stored copies. */
export const ConsentStateSchema = z
  .object({
    schema: z.literal(1),
    policyVersion: z.string().regex(POLICY_VERSION),
    categories: z.object({
      necessary: z.literal(true),
      functional: z.boolean(),
      analytics: z.boolean(),
      advertising: z.boolean(),
      personalization: z.boolean(),
    }),
    doNotSellOrShare: z.boolean(),
    source: z.enum(CONSENT_SOURCES),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .refine((s) => s.updatedAt >= s.createdAt, { message: "updatedAt precedes createdAt" })

/** A validated consent record. */
export type ConsentState = z.infer<typeof ConsentStateSchema>

/** Options for {@link createConsentState}. */
export interface CreateConsentOptions {
  /** Opt-in starts every category off; opt-out starts every category on. */
  readonly model: ConsentModel
  readonly policyVersion: string
  /** Milliseconds since the epoch. */
  readonly now: number
  /** True when the browser sent Global Privacy Control (`Sec-GPC: 1`). */
  readonly gpc?: boolean
}

function assertPolicyVersion(policyVersion: string): void {
  if (!POLICY_VERSION.test(policyVersion)) {
    throw new RangeError(`policyVersion must match ${POLICY_VERSION.source}`)
  }
}

function assertTimestamp(now: number): void {
  if (!Number.isInteger(now) || now < 0 || now > MAX_TIMESTAMP) {
    throw new RangeError("now must be an integer millisecond timestamp")
  }
}

/**
 * The record a visitor has before making any choice. Under GPC, advertising
 * and personalization start off and `doNotSellOrShare` is set, whatever the
 * model; first-party analytics still follows the model.
 */
export function createConsentState(options: CreateConsentOptions): ConsentState {
  assertPolicyVersion(options.policyVersion)
  assertTimestamp(options.now)
  const on = options.model === "opt-out"
  const gpc = options.gpc === true
  return {
    schema: 1,
    policyVersion: options.policyVersion,
    categories: {
      necessary: true,
      functional: on,
      analytics: on,
      advertising: on && !gpc,
      personalization: on && !gpc,
    },
    doNotSellOrShare: gpc,
    source: gpc ? "gpc" : "default",
    createdAt: options.now,
    updatedAt: options.now,
  }
}

/** A partial change to apply with {@link updateConsent}. */
export type ConsentChanges = Partial<Record<ConsentCategory, boolean>> & {
  readonly doNotSellOrShare?: boolean
}

/** Options for {@link updateConsent}. */
export interface UpdateConsentOptions {
  readonly now: number
  readonly source?: ConsentSource
  /** Move the record to a new policy version (after re-consent). */
  readonly policyVersion?: string
}

/**
 * Apply a visitor's choice. Returns a new record; the input is not modified.
 * Setting `doNotSellOrShare: true` also turns advertising off, since ads
 * cannot be granted while sale/sharing is refused.
 */
export function updateConsent(
  state: ConsentState,
  changes: ConsentChanges,
  options: UpdateConsentOptions,
): ConsentState {
  assertTimestamp(options.now)
  if (options.policyVersion !== undefined) assertPolicyVersion(options.policyVersion)
  const doNotSellOrShare = changes.doNotSellOrShare ?? state.doNotSellOrShare
  const advertising = (changes.advertising ?? state.categories.advertising) && !doNotSellOrShare
  return {
    ...state,
    policyVersion: options.policyVersion ?? state.policyVersion,
    categories: {
      necessary: true,
      functional: changes.functional ?? state.categories.functional,
      analytics: changes.analytics ?? state.categories.analytics,
      advertising,
      personalization: changes.personalization ?? state.categories.personalization,
    },
    doNotSellOrShare,
    source: options.source ?? "banner",
    updatedAt: Math.max(options.now, state.createdAt),
  }
}

/** Grant every category (an "Accept all" button). */
export function acceptAll(state: ConsentState, options: UpdateConsentOptions): ConsentState {
  return updateConsent(
    state,
    {
      functional: true,
      analytics: true,
      advertising: true,
      personalization: true,
      doNotSellOrShare: false,
    },
    options,
  )
}

/** Refuse every non-essential category (a "Reject all" button). */
export function rejectAll(state: ConsentState, options: UpdateConsentOptions): ConsentState {
  return updateConsent(
    state,
    {
      functional: false,
      analytics: false,
      advertising: false,
      personalization: false,
      doNotSellOrShare: true,
    },
    options,
  )
}

/** Options for {@link needsReconsent}. */
export interface ReconsentOptions {
  readonly policyVersion: string
  /** Ask again after this long, e.g. 13 months for CNIL guidance. */
  readonly maxAgeMs?: number
  readonly now?: number
}

/**
 * Should the banner be shown again? True when no record exists, the record
 * was never an explicit choice, its policy version differs, or it is older
 * than `maxAgeMs`.
 */
export function needsReconsent(
  state: ConsentState | undefined,
  options: ReconsentOptions,
): boolean {
  if (state === undefined) return true
  if (state.source === "default") return true
  if (state.policyVersion !== options.policyVersion) return true
  if (options.maxAgeMs !== undefined && options.now !== undefined) {
    return options.now - state.updatedAt > options.maxAgeMs
  }
  return false
}

const COOKIE_PREFIX = "c1"
const SOURCE_CODES: Readonly<Record<ConsentSource, string>> = {
  default: "d",
  banner: "b",
  gpc: "g",
  api: "a",
}

/**
 * Encode a record as a compact, cookie-safe string, for example
 * `c1:2026-01:0110:0:b:lx2k9c:lx2kab`. Fields: prefix, policy version,
 * category bits (functional, analytics, advertising, personalization),
 * do-not-sell flag, source code, created and updated times in base 36.
 * Every character is valid in a cookie value without escaping.
 */
export function serializeConsent(state: ConsentState): string {
  const parsed = ConsentStateSchema.parse(state)
  const bits = CONSENT_CATEGORIES.map((c) => (parsed.categories[c] ? "1" : "0")).join("")
  return [
    COOKIE_PREFIX,
    parsed.policyVersion,
    bits,
    parsed.doNotSellOrShare ? "1" : "0",
    SOURCE_CODES[parsed.source],
    parsed.createdAt.toString(36),
    parsed.updatedAt.toString(36),
  ].join(":")
}

/** Why a cookie value was rejected. */
export type ConsentParseError =
  | { readonly kind: "empty" }
  | { readonly kind: "malformed"; readonly message: string }
  | { readonly kind: "invalid"; readonly message: string }

const MAX_COOKIE_LENGTH = 256

/** Options for {@link parseConsent}. */
export interface ParseConsentOptions {
  /** When given, a record updated after `now + maxClockSkewMs` is rejected. */
  readonly now?: number
  /** Allowed clock skew for the future-timestamp check. Defaults to 5 minutes. */
  readonly maxClockSkewMs?: number
}

/**
 * Decode a cookie value written by {@link serializeConsent}. Tolerates
 * percent-encoding (some frameworks encode cookie values). Never throws.
 */
export function parseConsent(
  value: string | null | undefined,
  options: ParseConsentOptions = {},
): Result<ConsentState, ConsentParseError> {
  if (typeof value !== "string" || value.trim() === "") return err({ kind: "empty" })
  if (value.length > MAX_COOKIE_LENGTH) return err({ kind: "malformed", message: "value too long" })
  let raw = value.trim()
  if (raw.includes("%")) {
    try {
      raw = decodeURIComponent(raw)
    } catch {
      return err({ kind: "malformed", message: "bad percent-encoding" })
    }
  }
  const parts = raw.split(":")
  if (parts.length !== 7 || parts[0] !== COOKIE_PREFIX) {
    return err({ kind: "malformed", message: "unrecognized format" })
  }
  const [, policyVersion = "", bits = "", dnss = "", sourceCode = "", created = "", updated = ""] =
    parts
  if (!/^[01]{4}$/.test(bits) || !/^[01]$/.test(dnss)) {
    return err({ kind: "malformed", message: "bad flags" })
  }
  const source = CONSENT_SOURCES.find((k) => SOURCE_CODES[k] === sourceCode)
  if (source === undefined) return err({ kind: "malformed", message: "bad source" })
  if (!/^[0-9a-z]{1,11}$/.test(created) || !/^[0-9a-z]{1,11}$/.test(updated)) {
    return err({ kind: "malformed", message: "bad timestamp" })
  }
  const candidate = {
    schema: 1,
    policyVersion,
    categories: {
      necessary: true,
      functional: bits[0] === "1",
      analytics: bits[1] === "1",
      advertising: bits[2] === "1",
      personalization: bits[3] === "1",
    },
    doNotSellOrShare: dnss === "1",
    source,
    createdAt: Number.parseInt(created, 36),
    updatedAt: Number.parseInt(updated, 36),
  }
  const result = ConsentStateSchema.safeParse(candidate)
  if (!result.success) {
    return err({ kind: "invalid", message: result.error.issues.map((i) => i.message).join("; ") })
  }
  if (options.now !== undefined) {
    const skew = options.maxClockSkewMs ?? 5 * 60_000
    if (result.data.updatedAt > options.now + skew) {
      return err({ kind: "invalid", message: "timestamp is in the future" })
    }
  }
  return ok(result.data)
}
