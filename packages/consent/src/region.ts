/**
 * Map a visitor's location (ISO 3166-1 country, optional ISO 3166-2
 * subdivision) to a privacy regime, and from the regime to a consent model:
 * **opt-in** (nothing non-essential until the visitor agrees) or **opt-out**
 * (on by default, with a way to switch it off).
 *
 * NOT LEGAL ADVICE. The table below is a starting point that encodes one
 * posture: collect first-party data wherever the law allows an opt-out
 * default, and no further. Laws change and their reach is contested. Have
 * counsel review {@link DEFAULT_REGIME_TABLE} before relying on it, and pass
 * your own table to {@link classifyRegion} when your reading differs.
 *
 * An unknown or unresolvable location fails open to the `default` regime
 * (opt-out). That mirrors how Google Consent Mode applies its region-less
 * default, and it is the deliberate stance for local development and
 * header-less hosts. Pass `unknown: "opt-in"` to fail closed instead.
 *
 * @example
 * ```ts
 * classifyRegion({ country: "fr" }).regime.id // "gdpr"
 * classifyRegion({ country: "US", subdivision: "CA" }).regime.id // "us_state"
 * classifyRegion({ country: "XX" }).regime.id // "default" (Vercel unknown sentinel)
 * ```
 */

/** Identifier of a privacy regime in the table. */
export type RegimeId =
  | "gdpr"
  | "uk_gdpr"
  | "swiss_fadp"
  | "us_state"
  | "lgpd"
  | "pipeda"
  | "default"

/** Whether non-essential processing starts off (`opt-in`) or on (`opt-out`). */
export type ConsentModel = "opt-in" | "opt-out"

/** One row of the regime table. */
export interface Regime {
  readonly id: RegimeId
  /** Human-readable name of the law or framework. */
  readonly name: string
  readonly model: ConsentModel
  /**
   * True where the law requires honouring a browser-level opt-out signal such
   * as Global Privacy Control. This library honours GPC everywhere by default;
   * the flag is informational (for audit trails and banner copy).
   */
  readonly gpcRequired: boolean
}

/** The regime table: regimes by id, plus which locations map to which regime. */
export interface RegimeTable {
  readonly regimes: Readonly<Record<RegimeId, Regime>>
  /** Country code to regime id. */
  readonly countries: Readonly<Record<string, RegimeId>>
  /** `CC-SS` subdivision code to regime id. Checked before `countries`. */
  readonly subdivisions: Readonly<Record<string, RegimeId>>
  /**
   * Subdivisions with a stricter consent model than their regime's default,
   * keyed by `CC-SS`. Lets a table express "PIPEDA, but opt-in in this province"
   * without inventing a new regime id.
   */
  readonly modelOverrides?: Readonly<Record<string, ConsentModel>>
  /** Subdivisions where a GPC-honouring law applies, keyed by `CC-SS`. */
  readonly gpcRequiredSubdivisions?: readonly string[]
}

/** EU-27 plus the non-EU EEA states. */
export const EEA_COUNTRIES = [
  "AT",
  "BE",
  "BG",
  "HR",
  "CY",
  "CZ",
  "DK",
  "EE",
  "FI",
  "FR",
  "DE",
  "GR",
  "HU",
  "IE",
  "IT",
  "LV",
  "LT",
  "LU",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SK",
  "SI",
  "ES",
  "SE",
  "IS",
  "LI",
  "NO",
] as const

/**
 * EU territories that GeoIP reports under their own ISO code rather than the
 * parent state's: French outermost regions and Åland. GDPR applies in full.
 * Parent-coded territories (Azores, Canaries) already match via PT and ES.
 */
export const EU_TERRITORIES = ["GF", "GP", "MQ", "RE", "YT", "MF", "AX"] as const

/**
 * US states with a comprehensive consumer privacy law in force, as ISO 3166-2
 * codes. All are opt-out regimes for analytics and targeted advertising.
 * Review this list: several more laws take effect every year.
 */
export const US_PRIVACY_STATES = [
  "US-CA",
  "US-CO",
  "US-CT",
  "US-DE",
  "US-IA",
  "US-IN",
  "US-KY",
  "US-MD",
  "US-MN",
  "US-MT",
  "US-NE",
  "US-NH",
  "US-NJ",
  "US-OR",
  "US-RI",
  "US-TN",
  "US-TX",
  "US-UT",
  "US-VA",
] as const

/**
 * The subset of {@link US_PRIVACY_STATES} whose law (or regulations) requires
 * honouring a universal opt-out signal such as GPC.
 */
export const US_GPC_REQUIRED_STATES = [
  "US-CA",
  "US-CO",
  "US-CT",
  "US-DE",
  "US-MD",
  "US-MN",
  "US-MT",
  "US-NE",
  "US-NH",
  "US-NJ",
  "US-OR",
  "US-TX",
] as const

function fromList(codes: readonly string[], id: RegimeId): Record<string, RegimeId> {
  return Object.fromEntries(codes.map((code) => [code, id]))
}

/**
 * The shipped regime table. **Review before use.** Notable judgement calls:
 * LGPD and PIPEDA are modelled opt-out (implied consent for non-sensitive
 * analytics) except Quebec, whose Law 25 requires tracking technologies to
 * be off by default, which is modelled as an opt-in override.
 */
export const DEFAULT_REGIME_TABLE: RegimeTable = {
  regimes: {
    gdpr: { id: "gdpr", name: "EU GDPR + ePrivacy", model: "opt-in", gpcRequired: false },
    uk_gdpr: { id: "uk_gdpr", name: "UK GDPR + PECR", model: "opt-in", gpcRequired: false },
    swiss_fadp: { id: "swiss_fadp", name: "Swiss FADP", model: "opt-in", gpcRequired: false },
    us_state: {
      id: "us_state",
      name: "US state privacy law",
      model: "opt-out",
      gpcRequired: false,
    },
    lgpd: { id: "lgpd", name: "Brazil LGPD", model: "opt-out", gpcRequired: false },
    pipeda: { id: "pipeda", name: "Canada PIPEDA", model: "opt-out", gpcRequired: false },
    default: { id: "default", name: "No specific regime", model: "opt-out", gpcRequired: false },
  },
  countries: {
    ...fromList(EEA_COUNTRIES, "gdpr"),
    ...fromList(EU_TERRITORIES, "gdpr"),
    GB: "uk_gdpr",
    // Gibraltar kept a UK-GDPR-equivalent regime.
    GI: "uk_gdpr",
    CH: "swiss_fadp",
    BR: "lgpd",
    CA: "pipeda",
  },
  subdivisions: fromList(US_PRIVACY_STATES, "us_state"),
  modelOverrides: { "CA-QC": "opt-in" },
  gpcRequiredSubdivisions: US_GPC_REQUIRED_STATES,
}

/** A location as reported by a GeoIP header or lookup. */
export interface LocationInput {
  /** ISO 3166-1 alpha-2, any case. */
  readonly country?: string | null | undefined
  /** ISO 3166-2 subdivision: either the full `US-CA` form or just `CA`. */
  readonly subdivision?: string | null | undefined
}

/** Options for {@link classifyRegion}. */
export interface ClassifyRegionOptions {
  readonly table?: RegimeTable
  /** Model for an unknown country. Defaults to the `default` regime's model (opt-out). */
  readonly unknown?: ConsentModel
}

/** Result of {@link classifyRegion}. */
export interface RegionClassification {
  readonly regime: Regime
  /** The effective model, after any subdivision override. */
  readonly model: ConsentModel
  /** Whether a GPC-honouring law applies here (after subdivision rules). */
  readonly gpcRequired: boolean
  /** Normalized country, or `undefined` when unknown. */
  readonly country?: string
  /** Normalized `CC-SS` subdivision, when one was given and valid. */
  readonly subdivision?: string
}

/** GeoIP sentinels for "unknown": Vercel uses XX, and T1 for Tor exits. */
const UNKNOWN_COUNTRY_CODES: ReadonlySet<string> = new Set(["XX", "T1", "ZZ", "EU", "AP", "A1"])

/**
 * Normalize a country code to uppercase ISO 3166-1 alpha-2. Returns
 * `undefined` for missing, malformed or "unknown" sentinel values.
 */
export function normalizeCountry(country: string | null | undefined): string | undefined {
  if (typeof country !== "string") return undefined
  const code = country.trim().toUpperCase()
  if (!/^[A-Z][A-Z0-9]$/.test(code)) return undefined
  if (UNKNOWN_COUNTRY_CODES.has(code)) return undefined
  if (!/^[A-Z]{2}$/.test(code)) return undefined
  return code
}

/**
 * Normalize a subdivision to the full `CC-SS` form. Accepts `CA`, `us-ca` or
 * `US-CA`. A prefixed code whose country disagrees with `country` is rejected.
 */
export function normalizeSubdivision(
  country: string | undefined,
  subdivision: string | null | undefined,
): string | undefined {
  if (typeof subdivision !== "string" || country === undefined) return undefined
  const raw = subdivision.trim().toUpperCase()
  const match = /^(?:([A-Z]{2})-)?([A-Z0-9]{1,3})$/.exec(raw)
  if (match === null) return undefined
  const [, prefix, code] = match
  if (prefix !== undefined && prefix !== country) return undefined
  return `${country}-${code}`
}

/** Classify a location into a regime and consent model. */
export function classifyRegion(
  input: LocationInput,
  options: ClassifyRegionOptions = {},
): RegionClassification {
  const table = options.table ?? DEFAULT_REGIME_TABLE
  const country = normalizeCountry(input.country)
  const subdivision = normalizeSubdivision(country, input.subdivision)

  const regimeId: RegimeId =
    (subdivision !== undefined ? table.subdivisions[subdivision] : undefined) ??
    (country !== undefined ? table.countries[country] : undefined) ??
    "default"
  const regime = table.regimes[regimeId]

  let model = regime.model
  if (country === undefined && options.unknown !== undefined) model = options.unknown
  const override = subdivision !== undefined ? table.modelOverrides?.[subdivision] : undefined
  if (override !== undefined) model = override

  const gpcRequired =
    regime.gpcRequired ||
    (subdivision !== undefined && (table.gpcRequiredSubdivisions ?? []).includes(subdivision))

  return {
    regime,
    model,
    gpcRequired,
    ...(country !== undefined ? { country } : {}),
    ...(subdivision !== undefined ? { subdivision } : {}),
  }
}

/** Shorthand: does this location need prior (opt-in) consent? */
export function requiresOptIn(input: LocationInput, options: ClassifyRegionOptions = {}): boolean {
  return classifyRegion(input, options).model === "opt-in"
}

/**
 * Every location code whose effective model is opt-in: the country codes and
 * `CC-SS` overrides. This is the list a region-scoped Consent Mode default
 * needs (`gtag` accepts both forms).
 */
export function optInRegionCodes(table: RegimeTable = DEFAULT_REGIME_TABLE): string[] {
  const codes = new Set<string>()
  for (const [code, id] of Object.entries(table.countries)) {
    if (table.regimes[id].model === "opt-in") codes.add(code)
  }
  for (const [code, id] of Object.entries(table.subdivisions)) {
    if (table.regimes[id].model === "opt-in") codes.add(code)
  }
  for (const [code, model] of Object.entries(table.modelOverrides ?? {})) {
    if (model === "opt-in") codes.add(code)
    else codes.delete(code)
  }
  return [...codes].sort()
}
