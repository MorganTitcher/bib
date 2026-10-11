/**
 * @bib/consent: privacy-region classification, a consent record with a
 * cookie format, Google Consent Mode v2 commands, and first-party
 * attribution (UTMs, click IDs, referrers, first/last touch, URL cleaning).
 *
 * Every name is re-exported explicitly. Prefer the subpath imports
 * (`@bib/consent/region`, ...) for a narrower import graph.
 *
 * Not legal advice: review the regime table before relying on it.
 */

export {
  CLICK_ID_PARAMS,
  CLICK_ID_REGISTRY,
  type ClickId,
  type ClickIdChannel,
  type ClickIdDefinition,
  type ExtractClickIdOptions,
  extractClickIds,
  primaryClickId,
} from "./click-ids.ts"
export {
  type AdsDataRedactionCommand,
  allDenied,
  allGranted,
  applyGpc,
  buildAdsDataRedactionCommand,
  buildDefaultCommands,
  buildUpdateCommand,
  CONSENT_MODE_TYPES,
  type ConsentDefaultCommand,
  type ConsentDefaultParams,
  type ConsentModeOptions,
  type ConsentModeState,
  type ConsentModeType,
  type ConsentModeValue,
  type ConsentUpdateCommand,
  type DefaultCommandOptions,
  diffConsentMode,
  GPC_DENIED_TYPES,
  toConsentMode,
} from "./consent-mode.ts"
export {
  type ClassifyReferrerOptions,
  classifyReferrer,
  EMAIL_HOSTS,
  type HostTable,
  type ReferrerClassification,
  type ReferrerType,
  SEARCH_HOSTS,
  SOCIAL_HOSTS,
  TRANSIT_HOSTS,
} from "./referrer.ts"
export {
  type ClassifyRegionOptions,
  type ConsentModel,
  classifyRegion,
  DEFAULT_REGIME_TABLE,
  EEA_COUNTRIES,
  EU_TERRITORIES,
  type LocationInput,
  normalizeCountry,
  normalizeSubdivision,
  optInRegionCodes,
  type Regime,
  type RegimeId,
  type RegimeTable,
  type RegionClassification,
  requiresOptIn,
  US_GPC_REQUIRED_STATES,
  US_PRIVACY_STATES,
} from "./region.ts"
export {
  acceptAll,
  CONSENT_CATEGORIES,
  CONSENT_SOURCES,
  type ConsentCategories,
  type ConsentCategory,
  type ConsentChanges,
  type ConsentParseError,
  type ConsentSource,
  type ConsentState,
  ConsentStateSchema,
  type CreateConsentOptions,
  createConsentState,
  needsReconsent,
  type ParseConsentOptions,
  parseConsent,
  type ReconsentOptions,
  rejectAll,
  serializeConsent,
  type UpdateConsentOptions,
  updateConsent,
} from "./state.ts"
export {
  isTrackingParam,
  SENSITIVE_PARAM_PATTERN,
  type StripOptions,
  stripTrackingParams,
  stripTrackingSearchParams,
  TRACKING_PARAMS,
  TRACKING_PREFIXES,
} from "./strip.ts"
export {
  type AttributionRecord,
  AttributionRecordSchema,
  type AttributionStorage,
  type AttributionStorageError,
  type BuildTouchInput,
  buildTouch,
  CHANNELS,
  type Channel,
  channelFromMedium,
  isSameTouch,
  isSignalTouch,
  MAX_SERIALIZED_LENGTH,
  type MergeOptions,
  type MergeResult,
  mergeTouch,
  parseAttribution,
  readAttribution,
  recordTouch,
  serializeAttribution,
  type Touch,
  TouchSchema,
} from "./touch.ts"
export {
  formatUtm,
  hasUtm,
  MEDIUM_ALIASES,
  type ParseUtmOptions,
  parseUtm,
  UTM_FIELDS,
  type UtmParams,
} from "./utm.ts"
