import { describe, expect, it } from "vitest"
import {
  allDenied,
  allGranted,
  applyGpc,
  buildAdsDataRedactionCommand,
  buildDefaultCommands,
  buildUpdateCommand,
  CONSENT_MODE_TYPES,
  diffConsentMode,
  GPC_DENIED_TYPES,
  toConsentMode,
} from "../src/consent-mode.ts"
import { optInRegionCodes } from "../src/region.ts"
import { acceptAll, createConsentState, updateConsent } from "../src/state.ts"

const now = Date.UTC(2026, 0, 1)
const optIn = createConsentState({ model: "opt-in", policyVersion: "1", now })

describe("constants", () => {
  it("covers all seven Consent Mode v2 types", () => {
    expect(CONSENT_MODE_TYPES).toEqual([
      "ad_storage",
      "ad_user_data",
      "ad_personalization",
      "analytics_storage",
      "functionality_storage",
      "personalization_storage",
      "security_storage",
    ])
  })
  it("GPC denies ad signals only, never analytics", () => {
    expect(GPC_DENIED_TYPES).not.toContain("analytics_storage")
    expect(GPC_DENIED_TYPES).toContain("ad_user_data")
  })
})

describe("allGranted / allDenied / applyGpc", () => {
  it("keeps security granted even when denying", () => {
    expect(allDenied().security_storage).toBe("granted")
    expect(allDenied().analytics_storage).toBe("denied")
    expect(Object.values(allGranted()).every((v) => v === "granted")).toBe(true)
  })
  it("applyGpc leaves analytics and functionality alone", () => {
    const g = applyGpc(allGranted())
    expect(g.analytics_storage).toBe("granted")
    expect(g.functionality_storage).toBe("granted")
    for (const t of GPC_DENIED_TYPES) expect(g[t]).toBe("denied")
  })
})

describe("toConsentMode", () => {
  it("maps an untouched opt-in record to denied (security granted)", () => {
    expect(toConsentMode(optIn)).toEqual(allDenied())
  })

  it("maps accept-all to all granted", () => {
    expect(toConsentMode(acceptAll(optIn, { now }))).toEqual(allGranted())
  })

  it("needs personalization for ad_personalization", () => {
    const s = updateConsent(optIn, { advertising: true }, { now })
    const m = toConsentMode(s)
    expect(m.ad_storage).toBe("granted")
    expect(m.ad_user_data).toBe("granted")
    expect(m.ad_personalization).toBe("denied")
  })

  it("denies ad signals for a record flagged do-not-sell even if advertising is set", () => {
    // A hand-built or externally parsed record can carry both flags.
    const raw = { ...acceptAll(optIn, { now }), doNotSellOrShare: true }
    const m = toConsentMode(raw)
    expect(m.ad_storage).toBe("denied")
    expect(m.ad_user_data).toBe("denied")
    expect(m.ad_personalization).toBe("denied")
    expect(m.analytics_storage).toBe("granted")
  })

  it("applies GPC on top of a full grant unless told not to", () => {
    const all = acceptAll(optIn, { now })
    const m = toConsentMode(all, { gpc: true })
    expect(m.ad_storage).toBe("denied")
    expect(m.analytics_storage).toBe("granted")
    expect(toConsentMode(all, { gpc: true, honorGpc: false })).toEqual(allGranted())
  })
})

describe("buildDefaultCommands", () => {
  it("emits a region default then a global default", () => {
    const [region, global] = buildDefaultCommands()
    expect(region?.[0]).toBe("consent")
    expect(region?.[1]).toBe("default")
    expect(region?.[2]).toMatchObject({
      ad_storage: "denied",
      analytics_storage: "denied",
      functionality_storage: "granted",
      security_storage: "granted",
      wait_for_update: 500,
    })
    expect(region?.[2].region).toEqual(optInRegionCodes())
    expect(global?.[2]).toEqual(allGranted())
    expect(global?.[2].region).toBeUndefined()
  })

  it("honours GPC in the global default", () => {
    const [, global] = buildDefaultCommands({ gpc: true })
    expect(global?.[2].ad_storage).toBe("denied")
    expect(global?.[2].analytics_storage).toBe("granted")
  })

  it("supports an opt-in global default, custom regions and wait", () => {
    const cmds = buildDefaultCommands({
      globalModel: "opt-in",
      optInRegions: ["DE"],
      waitForUpdate: 0,
    })
    expect(cmds[0]?.[2].region).toEqual(["DE"])
    expect(cmds[0]?.[2].wait_for_update).toBe(0)
    expect(cmds[1]?.[2].analytics_storage).toBe("denied")
    expect(cmds[1]?.[2].wait_for_update).toBe(0)
  })

  it("omits the region command when no region is opt-in", () => {
    const cmds = buildDefaultCommands({ optInRegions: [] })
    expect(cmds).toHaveLength(1)
  })

  it("copies the region list so callers cannot mutate the source", () => {
    const regions = ["DE"]
    const [cmd] = buildDefaultCommands({ optInRegions: regions })
    expect(cmd?.[2].region).not.toBe(regions)
  })
})

describe("buildUpdateCommand / redaction / diff", () => {
  it("builds an update", () => {
    const s = updateConsent(optIn, { analytics: true }, { now })
    const [, kind, params] = buildUpdateCommand(s)
    expect(kind).toBe("update")
    expect(params.analytics_storage).toBe("granted")
  })

  it("asks for ads data redaction only when ads are denied", () => {
    expect(buildAdsDataRedactionCommand(allDenied())).toEqual(["set", "ads_data_redaction", true])
    expect(buildAdsDataRedactionCommand(allGranted())).toBeUndefined()
  })

  it("lists changed types", () => {
    expect(diffConsentMode(allDenied(), allDenied())).toEqual([])
    expect(diffConsentMode(allDenied(), allGranted())).toHaveLength(6)
  })
})
