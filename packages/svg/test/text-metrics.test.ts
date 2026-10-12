import { describe, expect, it } from "vitest"
import { estimateTextWidth, wrapText } from "../src/text-metrics.ts"

describe("estimateTextWidth", () => {
  it("scales linearly with font size", () => {
    expect(estimateTextWidth("passing", { fontSize: 22 })).toBeCloseTo(
      estimateTextWidth("passing") * 2,
    )
  })
  it("treats narrow and wide glyphs differently", () => {
    expect(estimateTextWidth("iiii")).toBeLessThan(estimateTextWidth("WWWW"))
  })
  it("gives all digits the same width so numbers do not jitter", () => {
    expect(estimateTextWidth("1111")).toBe(estimateTextWidth("8888"))
  })
  it("measures CJK and emoji as one em and combining marks as zero", () => {
    expect(estimateTextWidth("漢", { fontSize: 10 })).toBeCloseTo(10)
    expect(estimateTextWidth("😀", { fontSize: 10 })).toBeCloseTo(10)
    expect(estimateTextWidth("é")).toBeCloseTo(estimateTextWidth("e"))
  })
  it("widens bold text and adds letter spacing per glyph", () => {
    expect(estimateTextWidth("abc", { bold: true })).toBeCloseTo(estimateTextWidth("abc") * 1.08)
    expect(estimateTextWidth("abc", { letterSpacing: 2 })).toBeCloseTo(estimateTextWidth("abc") + 6)
  })
  it("returns 0 for empty text", () => {
    expect(estimateTextWidth("")).toBe(0)
  })
})

describe("wrapText", () => {
  it("wraps on word boundaries", () => {
    const { lines, truncated } = wrapText("one two three four five six", 60)
    expect(truncated).toBe(false)
    expect(lines.join(" ")).toBe("one two three four five six")
    for (const line of lines) expect(estimateTextWidth(line)).toBeLessThanOrEqual(60)
  })
  it("truncates at a word boundary with an ellipsis", () => {
    expect(
      wrapText("The quick brown fox jumps over the lazy dog", 120, { fontSize: 16, maxLines: 2 }),
    ).toEqual({
      lines: ["The quick", "brown fox…"],
      truncated: true,
    })
  })
  it("breaks words longer than a line by grapheme", () => {
    const { lines, truncated } = wrapText("Supercalifragilistic", 60)
    expect(truncated).toBe(true)
    expect(lines.join("")).toBe("Supercalifragilistic")
    expect(lines.length).toBeGreaterThan(1)
  })
  it("never splits an emoji grapheme", () => {
    const family = "👩\u200D👩\u200D👧\u200D👦"
    const { lines } = wrapText(family.repeat(6), 25, { fontSize: 10 })
    for (const line of lines) expect(line.length % family.length).toBe(0)
  })
  it("collapses whitespace and handles empty input", () => {
    expect(wrapText("  a \n\t b  ", 500).lines).toEqual(["a b"])
    expect(wrapText("", 100)).toEqual({ lines: [], truncated: false })
  })
  it("supports a custom ellipsis and maxLines 0", () => {
    expect(
      wrapText("aaa bbb ccc", 30, { maxLines: 1, ellipsis: "..." }).lines[0]?.endsWith("..."),
    ).toBe(true)
    expect(wrapText("aaa", 30, { maxLines: 0 })).toEqual({ lines: [], truncated: true })
  })
  it("rejects a non-positive width", () => {
    expect(() => wrapText("a", 0)).toThrow(RangeError)
  })
})
