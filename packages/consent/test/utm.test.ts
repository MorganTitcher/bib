import { describe, expect, it } from "vitest"
import { formatUtm, hasUtm, parseUtm } from "../src/utm.ts"

describe("parseUtm", () => {
  it("parses and normalizes a full URL", () => {
    expect(
      parseUtm("https://x.test/?utm_source=Google&utm_medium=PPC&utm_campaign=Spring%20Sale"),
    ).toEqual({ source: "google", medium: "cpc", campaign: "Spring Sale" })
  })

  it("accepts every input shape", () => {
    const expected = { source: "news" }
    expect(parseUtm("?utm_source=news")).toEqual(expected)
    expect(parseUtm("utm_source=news")).toEqual(expected)
    expect(parseUtm("/path?utm_source=news#frag")).toEqual(expected)
    expect(parseUtm(new URL("https://x.test/?utm_source=news"))).toEqual(expected)
    expect(parseUtm(new URLSearchParams("utm_source=news"))).toEqual(expected)
    expect(parseUtm({ utm_source: "news" })).toEqual(expected)
  })

  it("returns undefined when absent or only blank", () => {
    expect(parseUtm("https://x.test/")).toBeUndefined()
    expect(parseUtm("/path")).toBeUndefined()
    expect(parseUtm("?utm_source=&utm_medium=%20")).toBeUndefined()
    expect(parseUtm("")).toBeUndefined()
  })

  it("matches names case-insensitively and takes the first non-blank value", () => {
    expect(parseUtm("UTM_Source=&utm_source=A&utm_source=B")).toEqual({ source: "a" })
  })

  it("keeps case for labels and reads GA4 extras", () => {
    expect(
      parseUtm(
        "utm_campaign=Q1&utm_term=Running+Shoes&utm_content=Hero&utm_id=abc&utm_source_platform=DV360&utm_creative_format=Video&utm_marketing_tactic=Prospecting",
      ),
    ).toEqual({
      campaign: "Q1",
      term: "Running Shoes",
      content: "Hero",
      id: "abc",
      sourcePlatform: "dv360",
      creativeFormat: "Video",
      marketingTactic: "Prospecting",
    })
  })

  it("folds medium aliases unless disabled", () => {
    expect(parseUtm("utm_medium=e-mail")?.medium).toBe("email")
    expect(parseUtm("utm_medium=Newsletter")?.medium).toBe("email")
    expect(parseUtm("utm_medium=paidsocial")?.medium).toBe("paid_social")
    expect(parseUtm("utm_medium=PPC", { foldMediumAliases: false })?.medium).toBe("ppc")
  })

  it("collapses whitespace, caps length and drops control characters", () => {
    expect(parseUtm("utm_campaign=%20a%20%20b%20")?.campaign).toBe("a b")
    expect(parseUtm(`utm_campaign=${"x".repeat(500)}`)?.campaign).toHaveLength(100)
    expect(parseUtm(`utm_campaign=${"x".repeat(50)}`, { maxLength: 10 })?.campaign).toHaveLength(10)
    expect(parseUtm("utm_campaign=a%00b")).toBeUndefined()
  })

  it("does not split an emoji when truncating", () => {
    const value = parseUtm(`utm_campaign=${"a".repeat(9)}${encodeURIComponent("👍🏽")}`, {
      maxLength: 10,
    })?.campaign
    expect(value).toBe(`${"a".repeat(9)}👍🏽`)
  })

  it("survives malformed percent-encoding", () => {
    expect(() => parseUtm("utm_source=%E0%A4%A")).not.toThrow()
  })
})

describe("hasUtm / formatUtm", () => {
  it("detects UTMs", () => {
    expect(hasUtm("?utm_medium=email")).toBe(true)
    expect(hasUtm("?gclid=1")).toBe(false)
  })

  it("formats in a stable order and skips blanks", () => {
    expect(formatUtm({ campaign: "Spring Sale", source: "news", medium: " " })).toBe(
      "utm_source=news&utm_campaign=Spring+Sale",
    )
    expect(formatUtm({})).toBe("")
  })

  it("round-trips through parseUtm", () => {
    const utm = { source: "news", medium: "email", campaign: "Launch" }
    expect(parseUtm(formatUtm(utm))).toEqual(utm)
  })
})
