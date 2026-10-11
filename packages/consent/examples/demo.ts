/**
 * End-to-end walk through @bib/consent: classify a visitor's region, build
 * the Consent Mode defaults, record a banner choice in a cookie, and capture
 * first-party attribution from a landing URL.
 *
 * Run after building:
 *   pnpm --filter @bib/consent build
 *   node packages/consent/examples/demo.ts
 *
 * Expected output is listed in the package README ("Runnable example").
 */

import { buildDefaultCommands, buildUpdateCommand, toConsentMode } from "@bib/consent/consent-mode"
import { classifyReferrer } from "@bib/consent/referrer"
import { classifyRegion, optInRegionCodes } from "@bib/consent/region"
import {
  createConsentState,
  needsReconsent,
  parseConsent,
  serializeConsent,
  updateConsent,
} from "@bib/consent/state"
import { stripTrackingParams } from "@bib/consent/strip"
import { buildTouch, readAttribution, recordTouch } from "@bib/consent/touch"
import { parseUtm } from "@bib/consent/utm"

const now = Date.UTC(2026, 0, 15, 12, 0, 0)
const POLICY = "2026-01"

// 1. Region: a visitor in Germany needs opt-in; one in California sends GPC.
const de = classifyRegion({ country: "de" })
const ca = classifyRegion({ country: "US", subdivision: "CA" })
console.log("DE:", de.regime.id, de.model)
console.log("US-CA:", ca.regime.id, ca.model, "gpcRequired =", ca.gpcRequired)
console.log("opt-in region codes:", optInRegionCodes().length)

// 2. Consent Mode defaults, run before any tag loads.
const defaults = buildDefaultCommands()
console.log("default commands:", defaults.length)
console.log("opt-in default ad_storage:", defaults[0]?.[2].ad_storage)

// 3. A Californian with GPC: analytics stays on, ad signals are denied.
const gpcState = createConsentState({ model: ca.model, policyVersion: POLICY, now, gpc: true })
console.log("GPC mode:", JSON.stringify(toConsentMode(gpcState, { gpc: true })))

// 4. A German visitor accepts analytics only; store it in a cookie and read it back.
const initial = createConsentState({ model: de.model, policyVersion: POLICY, now })
const chosen = updateConsent(initial, { analytics: true }, { now: now + 1_000 })
const cookie = serializeConsent(chosen)
console.log("cookie:", cookie)
const parsed = parseConsent(cookie, { now: now + 2_000 })
console.log("parsed ok:", parsed.ok, "analytics:", parsed.ok && parsed.value.categories.analytics)
console.log("needs reconsent (same policy):", needsReconsent(chosen, { policyVersion: POLICY }))
console.log("needs reconsent (new policy):", needsReconsent(chosen, { policyVersion: "2026-06" }))
console.log("update:", JSON.stringify(buildUpdateCommand(chosen)[2]))

// 5. Attribution from a paid landing, then a later organic visit.
const landing =
  "https://shop.example.com/pricing?utm_source=Google&utm_medium=PPC&utm_campaign=Spring&gclid=Cj0abc&plan=pro"
console.log("utm:", JSON.stringify(parseUtm(landing)))
console.log("referrer:", JSON.stringify(classifyReferrer("https://www.google.co.uk/search?q=x")))

let stored: string | undefined
const storage = {
  get: () => stored,
  set: (v: string) => {
    stored = v
  },
}
const paid = buildTouch({ url: landing, now })
recordTouch(storage, paid)
const organic = buildTouch({
  url: "https://shop.example.com/blog",
  referrer: "https://duckduckgo.com/",
  now: now + 86_400_000,
})
recordTouch(storage, organic)
const record = readAttribution(storage)
console.log(
  "first touch:",
  record?.first.channel,
  record?.first.source,
  record?.first.clickId?.param,
)
console.log("last touch:", record?.last.channel, record?.last.source)
console.log("touches:", record?.touchCount)

// 6. Clean the URL once attribution is captured.
console.log("clean URL:", stripTrackingParams(landing))
