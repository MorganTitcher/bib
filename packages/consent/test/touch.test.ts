import { describe, expect, it } from "vitest"
import {
  type AttributionRecord,
  buildTouch,
  channelFromMedium,
  isSameTouch,
  mergeTouch,
  parseAttribution,
  readAttribution,
  recordTouch,
  serializeAttribution,
  type Touch,
} from "../src/touch.ts"

const t0 = Date.UTC(2026, 0, 1)
const DAY = 86_400_000

function memoryStorage(initial?: string) {
  let value = initial
  let writes = 0
  return {
    get: () => value,
    set: (v: string) => {
      value = v
      writes++
    },
    get writes() {
      return writes
    },
    get value() {
      return value
    },
  }
}

describe("channelFromMedium", () => {
  it.each([
    ["cpc", undefined, "paid_search"],
    ["cpc", "facebook", "paid_social"],
    ["paid_social", undefined, "paid_social"],
    ["display", undefined, "display"],
    ["social", undefined, "organic_social"],
    ["organic", "linkedin", "organic_social"],
    ["organic", "google", "organic_search"],
    ["email", undefined, "email"],
    ["affiliate", undefined, "affiliate"],
    ["referral", undefined, "referral"],
    ["podcast", undefined, "campaign"],
  ])("%s from %s is %s", (medium, source, channel) => {
    expect(channelFromMedium(medium, source)).toBe(channel)
  })
})

describe("buildTouch", () => {
  it("prefers utm_medium and records the click ID too", () => {
    const t = buildTouch({
      url: "https://s.test/p?utm_source=Google&utm_medium=cpc&utm_campaign=Q1&gclid=G1&token=secret",
      referrer: "https://www.google.com/",
      now: t0,
    })
    expect(t).toEqual({
      channel: "paid_search",
      source: "google",
      medium: "cpc",
      campaign: "Q1",
      clickId: { param: "gclid", value: "G1", platform: "google_ads" },
      referrerHost: "google.com",
      landingPath: "/p",
      at: t0,
    })
  })

  it("never stores the query string", () => {
    const t = buildTouch({ url: "https://s.test/reset?token=abc&email=a@b.test", now: t0 })
    expect(JSON.stringify(t)).not.toContain("abc")
    expect(t.landingPath).toBe("/reset")
  })

  it("uses the click ID when there is no medium", () => {
    expect(buildTouch({ url: "https://s.test/?fbclid=F1", now: t0 })).toMatchObject({
      channel: "paid_social",
      source: "meta",
      medium: "paid_social",
    })
    expect(buildTouch({ url: "https://s.test/?msclkid=M", now: t0 })).toMatchObject({
      channel: "paid_search",
      source: "microsoft_ads",
      medium: "cpc",
    })
  })

  it("treats a lone utm_source as campaign or organic social", () => {
    expect(buildTouch({ url: "https://s.test/?utm_source=partner", now: t0 })).toMatchObject({
      channel: "campaign",
      source: "partner",
      medium: "(not set)",
    })
    expect(buildTouch({ url: "https://s.test/?utm_source=linkedin", now: t0 }).channel).toBe(
      "organic_social",
    )
  })

  it("falls back to the referrer", () => {
    const base = { url: "https://s.test/", now: t0 }
    expect(buildTouch({ ...base, referrer: "https://duckduckgo.com/" })).toMatchObject({
      channel: "organic_search",
      source: "duckduckgo",
      medium: "organic",
    })
    expect(buildTouch({ ...base, referrer: "https://t.co/x" })).toMatchObject({
      channel: "organic_social",
      source: "x",
    })
    expect(buildTouch({ ...base, referrer: "https://mail.google.com/" }).channel).toBe("email")
    expect(buildTouch({ ...base, referrer: "https://blog.test/" })).toMatchObject({
      channel: "referral",
      source: "blog.test",
      medium: "referral",
    })
  })

  it("is direct with no signal, for internal hops and for transit hosts", () => {
    const base = { url: "https://s.test/", now: t0 }
    expect(buildTouch(base)).toMatchObject({
      channel: "direct",
      source: "(direct)",
      medium: "(none)",
    })
    const internal = buildTouch({ ...base, referrer: "https://s.test/a", siteHosts: ["s.test"] })
    expect(internal.channel).toBe("direct")
    expect(internal.referrerHost).toBeUndefined()
    expect(buildTouch({ ...base, referrer: "https://checkout.stripe.com/" }).channel).toBe("direct")
  })

  it("survives an unparseable URL", () => {
    expect(buildTouch({ url: "not a url", now: t0 }).channel).toBe("direct")
  })
})

const direct = (at: number): Touch => buildTouch({ url: "https://s.test/", now: at })
const paid = (at: number, campaign = "Q1"): Touch =>
  buildTouch({
    url: `https://s.test/?utm_source=google&utm_medium=cpc&utm_campaign=${campaign}`,
    now: at,
  })
const organic = (at: number): Touch =>
  buildTouch({ url: "https://s.test/", referrer: "https://bing.com/", now: at })

describe("mergeTouch", () => {
  it("starts a record", () => {
    const { record, changed } = mergeTouch(undefined, paid(t0))
    expect(changed).toBe(true)
    expect(record.touchCount).toBe(1)
    expect(record.first).toBe(record.last)
  })

  it("keeps the first touch and advances the last", () => {
    const r1 = mergeTouch(undefined, paid(t0)).record
    const r2 = mergeTouch(r1, organic(t0 + DAY)).record
    expect(r2.first.channel).toBe("paid_search")
    expect(r2.last.channel).toBe("organic_search")
    expect(r2.touchCount).toBe(2)
  })

  it("never lets a direct visit overwrite a real source", () => {
    const r1 = mergeTouch(undefined, paid(t0)).record
    const r2 = mergeTouch(r1, direct(t0 + 2 * DAY))
    expect(r2.record.last.channel).toBe("paid_search")
    expect(r2.record.seenAt).toBe(t0 + 2 * DAY)
  })

  it("lets a signal replace a direct first touch", () => {
    const r1 = mergeTouch(undefined, direct(t0)).record
    const r2 = mergeTouch(r1, paid(t0 + 10)).record
    expect(r2.first.channel).toBe("paid_search")
  })

  it("throttles activity-only writes", () => {
    const r1 = mergeTouch(undefined, paid(t0)).record
    expect(mergeTouch(r1, direct(t0 + 1_000)).changed).toBe(false)
    expect(mergeTouch(r1, paid(t0 + 1_000)).changed).toBe(false)
    expect(mergeTouch(r1, paid(t0 + DAY)).changed).toBe(true)
  })

  it("treats a different campaign as a new touch", () => {
    const r1 = mergeTouch(undefined, paid(t0)).record
    const r2 = mergeTouch(r1, paid(t0 + 1, "Q2"))
    expect(r2.changed).toBe(true)
    expect(r2.record.last.campaign).toBe("Q2")
    expect(isSameTouch(paid(t0), paid(t0 + 5))).toBe(true)
  })

  it("starts over after the inactivity window", () => {
    const r1 = mergeTouch(undefined, paid(t0)).record
    const r2 = mergeTouch(r1, organic(t0 + 91 * DAY)).record
    expect(r2.first.channel).toBe("organic_search")
    expect(r2.touchCount).toBe(1)
    // A direct visit after expiry keeps the old source if it had one.
    expect(mergeTouch(r1, direct(t0 + 91 * DAY)).record.first.channel).toBe("paid_search")
    const d = mergeTouch(undefined, direct(t0)).record
    expect(mergeTouch(d, direct(t0 + 91 * DAY)).record.first.at).toBe(t0 + 91 * DAY)
  })

  it("ignores out-of-order touches and does not mutate inputs", () => {
    const r1 = mergeTouch(undefined, paid(t0 + DAY)).record
    const snapshot = JSON.stringify(r1)
    expect(mergeTouch(r1, organic(t0))).toEqual({ record: r1, changed: false })
    mergeTouch(r1, organic(t0 + 2 * DAY))
    expect(JSON.stringify(r1)).toBe(snapshot)
  })
})

describe("serializeAttribution / parseAttribution", () => {
  const record = mergeTouch(mergeTouch(undefined, paid(t0)).record, organic(t0 + DAY)).record

  it("round-trips, encoded and plain", () => {
    const s = serializeAttribution(record)
    expect(s.ok).toBe(true)
    if (!s.ok) return
    expect(s.value).not.toMatch(/[;,\s"]/)
    expect(parseAttribution(s.value)).toEqual({ ok: true, value: record })
    expect(parseAttribution(JSON.stringify(record))).toEqual({ ok: true, value: record })
  })

  it("drops optional labels to fit, then reports too_large", () => {
    const big: AttributionRecord = {
      ...record,
      first: {
        ...record.first,
        term: "t".repeat(100),
        content: "c".repeat(100),
        landingPath: "/x",
      },
    }
    const full = serializeAttribution(big, 100_000)
    const fullLength = full.ok ? full.value.length : 0
    const slim = serializeAttribution(big, fullLength - 1)
    expect(slim.ok).toBe(true)
    if (slim.ok) expect(slim.value).not.toContain("ttttt")
    expect(serializeAttribution(big, 10)).toMatchObject({ ok: false, error: { kind: "too_large" } })
  })

  it.each([
    ["empty", "", "empty"],
    ["null", null, "empty"],
    ["not JSON", "%7Bbroken", "invalid"],
    ["bad shape", JSON.stringify({ schema: 1 }), "invalid"],
    ["huge", "x".repeat(20_000), "too_large"],
  ])("rejects %s input", (_n, value, kind) => {
    const r = parseAttribution(value)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.kind).toBe(kind)
  })

  it("rejects out-of-order timestamps", () => {
    const bad = { ...record, seenAt: record.first.at - 1 }
    expect(parseAttribution(JSON.stringify(bad)).ok).toBe(false)
  })
})

describe("recordTouch", () => {
  it("writes on change only", () => {
    const store = memoryStorage()
    expect(recordTouch(store, paid(t0)).ok).toBe(true)
    expect(store.writes).toBe(1)
    recordTouch(store, paid(t0 + 1_000))
    expect(store.writes).toBe(1)
    recordTouch(store, organic(t0 + 2_000))
    expect(store.writes).toBe(2)
    expect(readAttribution(store)?.last.channel).toBe("organic_search")
  })

  it("replaces a corrupt stored value", () => {
    const store = memoryStorage("%%%garbage")
    expect(readAttribution(store)).toBeUndefined()
    recordTouch(store, paid(t0))
    expect(readAttribution(store)?.first.channel).toBe("paid_search")
  })

  it("does not write when the record cannot fit", () => {
    const store = memoryStorage()
    const r = recordTouch(store, paid(t0), { maxLength: 10 })
    expect(r.ok).toBe(false)
    expect(store.writes).toBe(0)
  })
})
