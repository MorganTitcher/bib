import { describe, expect, it } from "vitest"
import {
  BADGE_COLORS,
  BADGE_HEIGHT,
  badgeMinimumContrast,
  badgeSegmentWidth,
  cleanBadgeText,
  metricColor,
  PERCENT_THRESHOLDS,
  renderBadge,
  renderMetricBadge,
} from "../src/badge.ts"
import { sanitizeSvg } from "../src/sanitize.ts"

describe("renderBadge", () => {
  it("renders a two-segment badge sized from the text", () => {
    const out = renderBadge({ label: "build", message: "passing", color: "green" })
    const width = badgeSegmentWidth("build") + badgeSegmentWidth("passing")
    expect(out).toContain(`width="${width}" height="${BADGE_HEIGHT}"`)
    expect(out).toContain('aria-label="build: passing"')
    expect(out).toContain("<title>build: passing</title>")
    expect(out).toContain(`fill="${BADGE_COLORS.green}"`)
  })
  it("renders a single segment when the label is empty", () => {
    const out = renderBadge({ message: "v1.2.3", color: "blue" })
    expect(out).toContain(`width="${badgeSegmentWidth("v1.2.3")}"`)
    expect(out).toContain('aria-label="v1.2.3"')
  })
  it("accepts custom hex colors and picks readable text", () => {
    const out = renderBadge({ label: "x", message: "y", color: "#facc15" })
    expect(out).toContain('fill="#facc15"')
    expect(out).toContain('fill="#111111"')
  })
  it("escapes untrusted text", () => {
    const out = renderBadge({ label: "<script>", message: '" onload="x' })
    expect(out).not.toContain("<script>")
    expect(out).not.toContain('onload="')
    expect(out).toContain("onload=&quot;x")
  })
  it("produces markup that survives the sanitizer unchanged", () => {
    const out = renderBadge({
      label: "coverage",
      message: "91%",
      color: "green",
      style: "flat-square",
    })
    const result = sanitizeSvg(out)
    expect(result.ok && result.svg).toBe(out)
  })
  it("uses different clip ids for different badges", () => {
    const id = (s: string) => /clipPath id="([^"]+)"/.exec(s)?.[1]
    expect(id(renderBadge({ label: "a", message: "1" }))).not.toBe(
      id(renderBadge({ label: "a", message: "2" })),
    )
  })
  it("throws on an empty message or a bad color", () => {
    expect(() => renderBadge({ message: "  " })).toThrow(TypeError)
    expect(() => renderBadge({ message: "x", color: "chartreuse-ish" })).toThrow(TypeError)
  })
})

describe("cleanBadgeText", () => {
  it("collapses whitespace and truncates long text", () => {
    expect(cleanBadgeText("  a \n b  ")).toBe("a b")
    expect(cleanBadgeText("x".repeat(100)).length).toBeLessThanOrEqual(32)
  })
})

describe("metric badges", () => {
  it("colors by threshold", () => {
    expect(metricColor(95, PERCENT_THRESHOLDS)).toBe("green")
    expect(metricColor(80, PERCENT_THRESHOLDS)).toBe("yellow")
    expect(metricColor(60, PERCENT_THRESHOLDS)).toBe("orange")
    expect(metricColor(10, PERCENT_THRESHOLDS)).toBe("red")
    expect(metricColor(Number.NaN, PERCENT_THRESHOLDS)).toBe("grey")
  })
  it("formats the value with digits and unit", () => {
    const out = renderMetricBadge({
      label: "coverage",
      value: 87.46,
      unit: "%",
      digits: 1,
      thresholds: PERCENT_THRESHOLDS,
    })
    expect(out).toContain(">87.5%</text>")
    expect(out).toContain(`fill="${BADGE_COLORS.yellow}"`)
  })
  it("renders n/a for non-finite values", () => {
    expect(renderMetricBadge({ label: "p95", value: Number.NaN })).toContain(">n/a</text>")
  })
  it("reports text contrast for every named color", () => {
    for (const color of Object.keys(BADGE_COLORS)) {
      expect(badgeMinimumContrast(color)).toBeGreaterThanOrEqual(4.5)
    }
  })
})
