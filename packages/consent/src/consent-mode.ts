/**
 * Google Consent Mode v2: turn a consent record into the seven consent types
 * `gtag` understands, and build the `consent default` / `consent update`
 * commands. Pure data out: the caller pushes the arrays onto `dataLayer` (or
 * calls `gtag(...cmd)`), so this module never touches the DOM.
 *
 * Global Privacy Control is a **sale/share** opt-out. It denies the ad
 * signals (`ad_storage`, `ad_user_data`, `ad_personalization`) and
 * `personalization_storage`. It does not deny first-party
 * `analytics_storage`, `functionality_storage` or `security_storage`.
 *
 * @example
 * ```ts
 * for (const cmd of buildDefaultCommands()) gtag(...cmd)
 * gtag(...buildUpdateCommand(state, { gpc: navigatorGpc }))
 * ```
 */

import { optInRegionCodes, type RegimeTable } from "./region.ts"
import type { ConsentState } from "./state.ts"

/** The seven Consent Mode v2 consent types. */
export const CONSENT_MODE_TYPES = [
  "ad_storage",
  "ad_user_data",
  "ad_personalization",
  "analytics_storage",
  "functionality_storage",
  "personalization_storage",
  "security_storage",
] as const

export type ConsentModeType = (typeof CONSENT_MODE_TYPES)[number]

export type ConsentModeValue = "granted" | "denied"

/** A value for every consent type. */
export type ConsentModeState = Readonly<Record<ConsentModeType, ConsentModeValue>>

/** The types GPC denies. */
export const GPC_DENIED_TYPES: readonly ConsentModeType[] = [
  "ad_storage",
  "ad_user_data",
  "ad_personalization",
  "personalization_storage",
]

/** The parameters of a `consent default` command. */
export type ConsentDefaultParams = Partial<Record<ConsentModeType, ConsentModeValue>> & {
  readonly region?: readonly string[]
  readonly wait_for_update?: number
}

/** `["consent", "default", params]`, ready for `gtag(...cmd)` or `dataLayer.push`. */
export type ConsentDefaultCommand = readonly ["consent", "default", ConsentDefaultParams]

/** `["consent", "update", params]`. */
export type ConsentUpdateCommand = readonly [
  "consent",
  "update",
  Partial<Record<ConsentModeType, ConsentModeValue>>,
]

/** `["set", "ads_data_redaction", boolean]`: redact ad click identifiers when ads are denied. */
export type AdsDataRedactionCommand = readonly ["set", "ads_data_redaction", boolean]

function value(granted: boolean): ConsentModeValue {
  return granted ? "granted" : "denied"
}

function uniform(v: ConsentModeValue): ConsentModeState {
  return {
    ad_storage: v,
    ad_user_data: v,
    ad_personalization: v,
    analytics_storage: v,
    functionality_storage: v,
    personalization_storage: v,
    security_storage: v,
  }
}

/** Every type granted. */
export function allGranted(): ConsentModeState {
  return uniform("granted")
}

/** Every type denied except `security_storage` (strictly necessary). */
export function allDenied(): ConsentModeState {
  return { ...uniform("denied"), security_storage: "granted" }
}

/** Deny the sale/share signals GPC covers, leaving first-party storage alone. */
export function applyGpc(state: ConsentModeState): ConsentModeState {
  return {
    ...state,
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
    personalization_storage: "denied",
  }
}

/** Options shared by the mapping functions. */
export interface ConsentModeOptions {
  /** True when the browser sent Global Privacy Control. */
  readonly gpc?: boolean
  /** Set false to ignore GPC (not recommended where a law requires honouring it). */
  readonly honorGpc?: boolean
}

/**
 * Map a consent record to Consent Mode values.
 * - `analytics_storage` follows `analytics`.
 * - `ad_storage` and `ad_user_data` need `advertising` and no do-not-sell.
 * - `ad_personalization` also needs `personalization`.
 * - `functionality_storage` follows `functional`.
 * - `personalization_storage` follows `personalization`.
 * - `security_storage` is always granted.
 * GPC is applied last.
 */
export function toConsentMode(
  state: ConsentState,
  options: ConsentModeOptions = {},
): ConsentModeState {
  const c = state.categories
  const ads = c.advertising && !state.doNotSellOrShare
  const mapped: ConsentModeState = {
    ad_storage: value(ads),
    ad_user_data: value(ads),
    ad_personalization: value(ads && c.personalization),
    analytics_storage: value(c.analytics),
    functionality_storage: value(c.functional),
    personalization_storage: value(c.personalization),
    security_storage: "granted",
  }
  return options.gpc === true && options.honorGpc !== false ? applyGpc(mapped) : mapped
}

/** Options for {@link buildDefaultCommands}. */
export interface DefaultCommandOptions extends ConsentModeOptions {
  /** Regime table whose opt-in locations get the denied default. */
  readonly table?: RegimeTable
  /** Override the opt-in region list directly. */
  readonly optInRegions?: readonly string[]
  /** Milliseconds tags wait for an update in opt-in regions. Defaults to 500. */
  readonly waitForUpdate?: number
  /**
   * The global (region-less) default. `"opt-out"` (default) grants everything;
   * `"opt-in"` denies like the opt-in regions do.
   */
  readonly globalModel?: "opt-in" | "opt-out"
}

/**
 * Build the `consent default` commands to run before any tag loads:
 * 1. A region-scoped default for opt-in regions: everything denied except
 *    `functionality_storage` and `security_storage`, with `wait_for_update`.
 * 2. A global default for everywhere else.
 *
 * Google applies the most specific matching region, so order does not matter,
 * but the region-scoped command comes first by convention. When `gpc` is
 * true, the global default also denies the GPC types.
 */
export function buildDefaultCommands(options: DefaultCommandOptions = {}): ConsentDefaultCommand[] {
  const regions = options.optInRegions ?? optInRegionCodes(options.table)
  const wait = options.waitForUpdate ?? 500
  const optIn: ConsentDefaultParams = {
    ...allDenied(),
    functionality_storage: "granted",
    region: [...regions],
    wait_for_update: wait,
  }
  let global: ConsentModeState = options.globalModel === "opt-in" ? allDenied() : allGranted()
  if (options.gpc === true && options.honorGpc !== false) global = applyGpc(global)
  const globalParams: ConsentDefaultParams =
    options.globalModel === "opt-in"
      ? { ...global, functionality_storage: "granted", wait_for_update: wait }
      : { ...global }
  const commands: ConsentDefaultCommand[] = []
  if (regions.length > 0) commands.push(["consent", "default", optIn])
  commands.push(["consent", "default", globalParams])
  return commands
}

/** Build the `consent update` command for a stored or just-made choice. */
export function buildUpdateCommand(
  state: ConsentState,
  options: ConsentModeOptions = {},
): ConsentUpdateCommand {
  return ["consent", "update", { ...toConsentMode(state, options) }]
}

/**
 * Build `["set", "ads_data_redaction", true]` when ad storage is denied, so
 * Google redacts ad click identifiers in pings. Returns `undefined` when ads
 * are granted.
 */
export function buildAdsDataRedactionCommand(
  mode: ConsentModeState,
): AdsDataRedactionCommand | undefined {
  return mode.ad_storage === "denied" ? ["set", "ads_data_redaction", true] : undefined
}

/** Types whose value differs between two states, for logging or minimal updates. */
export function diffConsentMode(
  before: ConsentModeState,
  after: ConsentModeState,
): ConsentModeType[] {
  return CONSENT_MODE_TYPES.filter((t) => before[t] !== after[t])
}
