import { describe, expect, it } from "vitest"
import { isTrackingParam, stripTrackingParams, stripTrackingSearchParams } from "../src/strip.ts"

describe("isTrackingParam", () => {
  it("matches UTMs, click IDs and known trackers case-insensitively", () => {
    for (const n of [
      "utm_source",
      "UTM_Campaign",
      "gclid",
      "ScCid",
      "_ga",
      "_gl",
      "srsltid",
      "mtm_kwd",
      "hsa_acc",
    ]) {
      expect(isTrackingParam(n)).toBe(true)
    }
    for (const n of ["plan", "q", "page", "id", "utm"]) expect(isTrackingParam(n)).toBe(false)
  })

  it("honours keep, remove and sensitive", () => {
    expect(isTrackingParam("gclid", { keep: ["GCLID"] })).toBe(false)
    expect(isTrackingParam("ref", { remove: ["ref"] })).toBe(true)
    expect(isTrackingParam("token")).toBe(false)
    expect(isTrackingParam("token", { sensitive: true })).toBe(true)
    expect(isTrackingParam("reset_token", { sensitive: true })).toBe(true)
    expect(isTrackingParam("email", { sensitive: true })).toBe(true)
    expect(isTrackingParam("keyword", { sensitive: true })).toBe(false)
  })
})

describe("stripTrackingParams", () => {
  it("removes trackers, keeps order, encoding and the fragment", () => {
    expect(stripTrackingParams("https://x.test/p?b=2&utm_source=x&a=%20one&gclid=1&c=3#frag")).toBe(
      "https://x.test/p?b=2&a=%20one&c=3#frag",
    )
  })

  it("drops the ? when nothing is left", () => {
    expect(stripTrackingParams("https://x.test/p?utm_source=x&fbclid=1")).toBe("https://x.test/p")
  })

  it("returns the input unchanged when there is nothing to strip", () => {
    const u = "https://X.test/p?b=2&a=1"
    expect(stripTrackingParams(u)).toBe(u)
    expect(stripTrackingParams("https://x.test/")).toBe("https://x.test/")
  })

  it("keeps relative URLs relative", () => {
    expect(stripTrackingParams("/pricing?plan=pro&utm_source=x&gclid=1#faq")).toBe(
      "/pricing?plan=pro#faq",
    )
    expect(stripTrackingParams("pricing?utm_medium=x")).toBe("pricing")
    expect(stripTrackingParams("?utm_source=x&q=1")).toBe("?q=1")
    expect(stripTrackingParams("//cdn.test/a?utm_source=x&v=1")).toBe("//cdn.test/a?v=1")
  })

  it("handles encoded names, empty pairs and repeated params", () => {
    expect(stripTrackingParams("https://x.test/?utm%5Fsource=x&&a=1&utm_source=y")).toBe(
      "https://x.test/?a=1",
    )
  })

  it("returns invalid or empty input unchanged", () => {
    expect(stripTrackingParams("")).toBe("")
    expect(stripTrackingParams("http://[bad")).toBe("http://[bad")
  })

  it("strips sensitive params only on request", () => {
    const u = "https://x.test/cb?code=abc&state=1&email=a%40b.test"
    expect(stripTrackingParams(u)).toBe(u)
    expect(stripTrackingParams(u, { sensitive: true })).toBe("https://x.test/cb?state=1")
  })
})

describe("stripTrackingSearchParams", () => {
  it("removes in place and reports the names", () => {
    const params = new URLSearchParams("a=1&utm_source=x&utm_source=y&gclid=2")
    expect(stripTrackingSearchParams(params)).toEqual(["utm_source", "gclid"])
    expect(params.toString()).toBe("a=1")
  })
})
