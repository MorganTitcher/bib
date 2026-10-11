import { describe, expect, it } from "vitest"
import {
  acceptAll,
  ConsentStateSchema,
  createConsentState,
  needsReconsent,
  parseConsent,
  rejectAll,
  serializeConsent,
  updateConsent,
} from "../src/state.ts"

const now = Date.UTC(2026, 0, 1)
const base = { policyVersion: "2026-01", now }

describe("createConsentState", () => {
  it("starts everything off under opt-in", () => {
    const s = createConsentState({ ...base, model: "opt-in" })
    expect(s.categories).toEqual({
      necessary: true,
      functional: false,
      analytics: false,
      advertising: false,
      personalization: false,
    })
    expect(s.source).toBe("default")
    expect(ConsentStateSchema.safeParse(s).success).toBe(true)
  })

  it("starts everything on under opt-out", () => {
    const s = createConsentState({ ...base, model: "opt-out" })
    expect(s.categories.analytics).toBe(true)
    expect(s.categories.advertising).toBe(true)
  })

  it("under GPC denies ads and personalization but keeps first-party analytics", () => {
    const s = createConsentState({ ...base, model: "opt-out", gpc: true })
    expect(s.categories.analytics).toBe(true)
    expect(s.categories.functional).toBe(true)
    expect(s.categories.advertising).toBe(false)
    expect(s.categories.personalization).toBe(false)
    expect(s.doNotSellOrShare).toBe(true)
    expect(s.source).toBe("gpc")
  })

  it("rejects a bad policy version or timestamp", () => {
    expect(() => createConsentState({ ...base, model: "opt-in", policyVersion: "a b" })).toThrow(
      RangeError,
    )
    expect(() => createConsentState({ ...base, model: "opt-in", policyVersion: "" })).toThrow()
    expect(() => createConsentState({ ...base, model: "opt-in", now: -1 })).toThrow(RangeError)
    expect(() => createConsentState({ ...base, model: "opt-in", now: 1.5 })).toThrow(RangeError)
  })
})

describe("updateConsent", () => {
  const initial = createConsentState({ ...base, model: "opt-in" })

  it("applies a partial change without mutating the input", () => {
    const next = updateConsent(initial, { analytics: true }, { now: now + 10 })
    expect(next.categories.analytics).toBe(true)
    expect(next.categories.advertising).toBe(false)
    expect(next.source).toBe("banner")
    expect(next.updatedAt).toBe(now + 10)
    expect(next.createdAt).toBe(now)
    expect(initial.categories.analytics).toBe(false)
  })

  it("forces advertising off while sale/sharing is refused", () => {
    const next = updateConsent(initial, { advertising: true, doNotSellOrShare: true }, { now })
    expect(next.categories.advertising).toBe(false)
    const later = updateConsent(next, { advertising: true }, { now })
    expect(later.categories.advertising).toBe(false)
    const lifted = updateConsent(later, { advertising: true, doNotSellOrShare: false }, { now })
    expect(lifted.categories.advertising).toBe(true)
  })

  it("never moves updatedAt before createdAt", () => {
    const next = updateConsent(initial, {}, { now: now - 1_000 })
    expect(next.updatedAt).toBe(now)
  })

  it("can move to a new policy version and records the source", () => {
    const next = updateConsent(initial, {}, { now, policyVersion: "2026-06", source: "api" })
    expect(next.policyVersion).toBe("2026-06")
    expect(next.source).toBe("api")
    expect(() => updateConsent(initial, {}, { now, policyVersion: "bad version" })).toThrow()
  })

  it("acceptAll and rejectAll", () => {
    const yes = acceptAll(initial, { now })
    expect(Object.values(yes.categories).every(Boolean)).toBe(true)
    expect(yes.doNotSellOrShare).toBe(false)
    const no = rejectAll(yes, { now })
    expect(no.categories).toMatchObject({ functional: false, analytics: false, advertising: false })
    expect(no.categories.necessary).toBe(true)
    expect(no.doNotSellOrShare).toBe(true)
  })
})

describe("needsReconsent", () => {
  const chosen = acceptAll(createConsentState({ ...base, model: "opt-in" }), { now })

  it("is true with no record or only a default record", () => {
    expect(needsReconsent(undefined, { policyVersion: "2026-01" })).toBe(true)
    const d = createConsentState({ ...base, model: "opt-out" })
    expect(needsReconsent(d, { policyVersion: "2026-01" })).toBe(true)
  })

  it("compares policy version and age", () => {
    expect(needsReconsent(chosen, { policyVersion: "2026-01" })).toBe(false)
    expect(needsReconsent(chosen, { policyVersion: "2026-02" })).toBe(true)
    const day = 86_400_000
    expect(
      needsReconsent(chosen, { policyVersion: "2026-01", maxAgeMs: day, now: now + day }),
    ).toBe(false)
    expect(
      needsReconsent(chosen, { policyVersion: "2026-01", maxAgeMs: day, now: now + day + 1 }),
    ).toBe(true)
  })
})

describe("serializeConsent / parseConsent", () => {
  const state = updateConsent(
    createConsentState({ ...base, model: "opt-in" }),
    { analytics: true, personalization: true },
    { now: now + 5_000 },
  )

  it("round-trips", () => {
    const cookie = serializeConsent(state)
    expect(cookie).toMatch(/^c1:2026-01:0101:0:b:[0-9a-z]+:[0-9a-z]+$/)
    const parsed = parseConsent(cookie)
    expect(parsed).toEqual({ ok: true, value: state })
  })

  it("tolerates a percent-encoded value", () => {
    const parsed = parseConsent(encodeURIComponent(serializeConsent(state)))
    expect(parsed.ok).toBe(true)
  })

  it("round-trips GPC state with the do-not-sell flag", () => {
    const gpc = createConsentState({ ...base, model: "opt-out", gpc: true })
    const parsed = parseConsent(serializeConsent(gpc))
    expect(parsed.ok && parsed.value.doNotSellOrShare).toBe(true)
    expect(parsed.ok && parsed.value.source).toBe("gpc")
  })

  it("reports empty input", () => {
    expect(parseConsent("")).toEqual({ ok: false, error: { kind: "empty" } })
    expect(parseConsent(undefined)).toEqual({ ok: false, error: { kind: "empty" } })
    expect(parseConsent(null)).toEqual({ ok: false, error: { kind: "empty" } })
  })

  it.each([
    "garbage",
    "c2:2026-01:0101:0:b:1:2",
    "c1:2026-01:010:0:b:1:2",
    "c1:2026-01:0101:2:b:1:2",
    "c1:2026-01:0101:0:x:1:2",
    "c1:2026-01:0101:0:b:!!:2",
    "c1:2026-01:0101:0:b:1",
    "%E0%A4%A",
    "x".repeat(300),
  ])("rejects malformed value %s", (v) => {
    const parsed = parseConsent(v)
    expect(parsed.ok).toBe(false)
  })

  it("rejects updatedAt before createdAt", () => {
    const parsed = parseConsent("c1:2026-01:0101:0:b:z:a")
    expect(parsed.ok).toBe(false)
  })

  it("rejects timestamps in the future beyond the clock skew allowance", () => {
    const cookie = serializeConsent(state)
    expect(parseConsent(cookie, { now: now + 5_000 }).ok).toBe(true)
    expect(parseConsent(cookie, { now: now - 10 * 60_000 }).ok).toBe(false)
    expect(parseConsent(cookie, { now: now - 60_000, maxClockSkewMs: 120_000 }).ok).toBe(true)
  })

  it("refuses to serialize an invalid record", () => {
    expect(() => serializeConsent({ ...state, policyVersion: "has space" })).toThrow()
  })
})
