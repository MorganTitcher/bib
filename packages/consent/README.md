# @bib/consent

Privacy-region classification, a versioned consent record with a compact cookie
format, Google Consent Mode v2 commands, and first-party attribution: UTM
parsing, click-ID extraction, referrer classification, first/last-touch
storage, and tracking-parameter stripping. Everything is a pure function. There
is no DOM access and no framework coupling; storage is passed in.

> **Not legal advice.** The regime table (`DEFAULT_REGIME_TABLE`, the EEA and
> US state lists, the GPC subset) is an engineering default, not a legal
> opinion. Laws, enforcement and guidance change. Have the table reviewed by
> someone qualified for your jurisdictions before you rely on it, and pass your
> own table via the `table` option where it differs.

## Posture

The defaults collect as much first-party analytics as the modelled law allows
and degrade only where a specific rule requires it:

- **Opt-in** (nothing non-essential until the visitor agrees): EEA countries and
  EU outermost territories (GDPR), GB/GI (UK GDPR), CH, and Quebec (`CA-QC`).
- **Opt-out** (on until the visitor says no): US privacy states, Brazil (LGPD),
  the rest of Canada (PIPEDA), and every unknown or unclassified country.
- **Global Privacy Control** is a *sale/share* opt-out. It denies the ad signals
  (`ad_storage`, `ad_user_data`, `ad_personalization`) and
  `personalization_storage`. It never denies first-party analytics.

## Importing

Every module is a subpath export. Import from the narrowest one:

```ts
import { classifyRegion } from "@bib/consent/region"
import { buildDefaultCommands } from "@bib/consent/consent-mode"
```

The root `@bib/consent` barrel re-exports every public name explicitly.

## Maturity

The whole package is `experimental` (`"bib": { "maturity": "experimental" }`).

| Module | Status | Ported from | Notes |
|---|---|---|---|
| `region` | experimental | inkwell (analytics posture) + new | Regimes `gdpr`, `uk_gdpr`, `us_state`, `lgpd`, `pipeda`, `default`. Unknown countries fail open to `default` (opt-out). `CA-QC` is the only subdivision override |
| `state` | experimental | inkwell (consent) | Five categories, policy versioning, timestamps. zod-validated `c1:` cookie; parse never throws |
| `consent-mode` | experimental | inkwell + adsights-web (ideas) | All seven v2 types; region default + global default; update; ads data redaction; GPC limited to ad signals |
| `utm` | experimental | adsights-web | Five UTM fields; source/medium lowercased, medium aliases (`ppc` → `cpc`, `e-mail` → `email`); campaign case kept |
| `click-ids` | experimental | adsights-web + new | Registry of ad-platform click IDs, checked by web search in 2026-10; value shape validated |
| `referrer` | experimental | adsights-web | `search` / `social` / `email` / `direct` / `referral`. Exact-or-subdomain host matching; webmail before search; transit hosts (OAuth, payment) count as direct |
| `touch` | experimental | adsights-web | Touch precedence: medium, click ID, source, referrer, direct. 90-day window, 1-day refresh throttle, direct never overwrites a real source |
| `strip` | experimental | adsights-web | Removes `utm_*`, click IDs and common analytics/email params; optional sensitive-param stripping for logs |

## Usage

Outputs below were checked against the built `dist/`.

### region

```ts
import { classifyRegion, requiresOptIn, optInRegionCodes } from "@bib/consent/region"

classifyRegion({ country: "fr" })                     // regime.id "gdpr", model "opt-in"
classifyRegion({ country: "CA", subdivision: "QC" }) // model "opt-in" (Quebec)
classifyRegion({ country: "CA" })                    // model "opt-out" (PIPEDA)
classifyRegion({ country: "XX" })                    // regime.id "default" (unknown fails open)
requiresOptIn({ country: "GB" })                     // true
optInRegionCodes().includes("CA-QC")                 // true
```

### state

```ts
import { createConsentState, updateConsent, serializeConsent, parseConsent, needsReconsent } from "@bib/consent/state"

const now = Date.UTC(2026, 0, 1)
let s = createConsentState({ model: "opt-in", policyVersion: "v3", now })
// s.categories: { necessary: true, functional: false, analytics: false, advertising: false, personalization: false }
s = updateConsent(s, { analytics: true }, { now: now + 1 })
serializeConsent(s)                      // "c1:v3:0100:0:b:mjuohs00:mjuohs01"
parseConsent("garbage")                  // { ok: false, error: { kind: "malformed", ... } }
needsReconsent(s, { policyVersion: "v4" }) // true
```

### consent-mode

```ts
import { buildDefaultCommands, buildUpdateCommand, buildAdsDataRedactionCommand, toConsentMode } from "@bib/consent/consent-mode"

// Push each command to gtag/dataLayer before any tag loads.
const [regionDefault, globalDefault] = buildDefaultCommands({ gpc: true })
// regionDefault: opt-in regions denied (functionality/security granted), wait_for_update 500
// globalDefault[2]: ad_storage "denied", analytics_storage "granted" (GPC)

buildUpdateCommand(state, { gpc: true })            // ["consent", "update", { ... }]
buildAdsDataRedactionCommand(toConsentMode(state))  // ["set", "ads_data_redaction", true] when ads are denied
```

### utm

```ts
import { parseUtm, hasUtm, formatUtm } from "@bib/consent/utm"

parseUtm("?utm_source=Newsletter&utm_medium=E-mail&utm_campaign=Launch")
// { source: "newsletter", medium: "email", campaign: "Launch" }
hasUtm("https://x.com/?a=1")                     // false
formatUtm({ source: "google", medium: "cpc" })  // "utm_source=google&utm_medium=cpc"
```

### click-ids

```ts
import { extractClickIds, primaryClickId } from "@bib/consent/click-ids"

extractClickIds("?gclid=abc&fbclid=def").map((c) => c.param) // ["gclid", "fbclid"]
primaryClickId("?msclkid=zz")?.channel                       // "paid_search"
```

### referrer

```ts
import { classifyReferrer } from "@bib/consent/referrer"

classifyReferrer("https://mail.google.com/")      // { type: "email", source: "gmail", host: "mail.google.com" }
classifyReferrer("https://t.co/abc")              // { type: "social", source: "x", host: "t.co" }
classifyReferrer("https://blog.example.org/post") // { type: "referral", source: "blog.example.org", ... }
classifyReferrer("")                              // { type: "direct" }
```

### touch

```ts
import { buildTouch, mergeTouch, recordTouch, readAttribution } from "@bib/consent/touch"

let cookie: string | undefined
const storage = { get: () => cookie, set: (v: string) => { cookie = v } }

const paid = buildTouch({ url: "https://site.test/?utm_source=bing&utm_medium=cpc", now })
// paid.channel "paid_search", source "bing", medium "cpc"
recordTouch(storage, paid)          // { ok: true, value: { record, changed: true } }
readAttribution(storage)?.touchCount // 1

const direct = buildTouch({ url: "https://site.test/", now: now + 60_000 })
mergeTouch(readAttribution(storage), direct).changed // false: direct never overwrites a source
```

### strip

```ts
import { stripTrackingParams, stripTrackingSearchParams } from "@bib/consent/strip"

stripTrackingParams("/pricing?plan=pro&utm_source=x&gclid=1#faq")              // "/pricing?plan=pro#faq"
stripTrackingParams("https://a.test/reset?token=abc&page=2", { sensitive: true }) // "https://a.test/reset?page=2"

const sp = new URLSearchParams("q=1&fbclid=x&_ga=y")
stripTrackingSearchParams(sp) // ["fbclid", "_ga"]; sp is now "q=1"
```

## Runnable example

`examples/demo.ts` walks the whole flow: region, defaults, a GPC visitor, a
banner choice round-tripped through a cookie, and attribution from a paid landing
followed by an organic visit.

```sh
pnpm --filter @bib/consent build
node packages/consent/examples/demo.ts
```

Expected output:

```
DE: gdpr opt-in
US-CA: us_state opt-out gpcRequired = true
opt-in region codes: 41
default commands: 2
opt-in default ad_storage: denied
GPC mode: {"ad_storage":"denied","ad_user_data":"denied","ad_personalization":"denied","analytics_storage":"granted","functionality_storage":"granted","personalization_storage":"denied","security_storage":"granted"}
cookie: c1:2026-01:0100:0:b:mkfedmo0:mkfednfs
parsed ok: true analytics: true
needs reconsent (same policy): false
needs reconsent (new policy): true
update: {"ad_storage":"denied","ad_user_data":"denied","ad_personalization":"denied","analytics_storage":"granted","functionality_storage":"denied","personalization_storage":"denied","security_storage":"granted"}
utm: {"source":"google","medium":"cpc","campaign":"Spring"}
referrer: {"type":"search","source":"google","host":"google.co.uk"}
first touch: paid_search google gclid
last touch: organic_search duckduckgo
touches: 2
clean URL: https://shop.example.com/pricing?plan=pro
```

## Not yet / limits

- **The regime table needs review.** The US list reflects state laws in effect
  or enacted as of 2026; new states and amendments need manual updates.
- **Subdivisions:** only Quebec overrides its country. No per-state EU or
  per-province rules beyond that.
- **No geolocation.** You supply the country and subdivision (CDN header,
  GeoIP). Sentinel codes (`XX`, `T1`, `ZZ`, `EU`, `AP`, `A1`) are treated as unknown.
- **No CMP strings:** no IAB TCF v2 string and no IAB GPP string. Consent Mode only.
- **Click IDs drift.** Platforms add and rename parameters; the registry needs upkeep.
- **Attribution is per browser.** No cross-device or server-side identity stitching,
  and no multi-touch models beyond first and last.
- **Storage is synchronous** (cookie / `localStorage` shaped). No async adapter.
- **Referrer tables are curated**, not exhaustive. Unknown hosts are `referral`.
