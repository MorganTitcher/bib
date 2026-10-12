import { describe, expect, it } from "vitest"
import {
  normalizeCardText,
  OG_HEIGHT,
  OG_LIGHT_THEME,
  OG_WIDTH,
  renderOgCard,
} from "../src/og-card.ts"
import { sanitizeSvg } from "../src/sanitize.ts"

describe("renderOgCard", () => {
  it("renders a 1200x630 card with title and subtitle", () => {
    const card = renderOgCard({
      title: "Release notes",
      subtitle: "What changed this week",
      footer: "example.com",
    })
    expect(card.svg).toContain(`width="${OG_WIDTH}" height="${OG_HEIGHT}"`)
    expect(card.svg).toContain(`viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}"`)
    expect(card.titleLines).toEqual(["Release notes"])
    expect(card.subtitleLines).toEqual(["What changed this week"])
    expect(card.truncated).toBe(false)
    expect(card.lowContrast).toEqual([])
  })
  it("wraps and truncates long titles to maxTitleLines", () => {
    const card = renderOgCard({ title: "word ".repeat(80), maxTitleLines: 2 })
    expect(card.titleLines).toHaveLength(2)
    expect(card.titleLines[1]?.endsWith("…")).toBe(true)
    expect(card.truncated).toBe(true)
  })
  it("escapes untrusted text and survives the sanitizer", () => {
    const card = renderOgCard({
      title: "<script>alert(1)</script>",
      eyebrow: "a & b",
      footer: '"><x>',
    })
    expect(card.svg).not.toContain("<script>")
    const result = sanitizeSvg(card.svg)
    expect(result.ok && result.svg).toBe(card.svg)
  })
  it("flags theme pairs below AA contrast", () => {
    const card = renderOgCard({
      title: "x",
      theme: { background: "#ffffff", foreground: "#eeeeee" },
    })
    expect(card.lowContrast).toContain("foreground")
    expect(card.lowContrast.length).toBeGreaterThan(0)
  })
  it("supports the light theme", () => {
    const card = renderOgCard({ title: "x", theme: OG_LIGHT_THEME })
    expect(card.svg).toContain(OG_LIGHT_THEME.background)
    expect(card.lowContrast).toEqual([])
  })
  it("throws on an empty title or a bad color", () => {
    expect(() => renderOgCard({ title: "   " })).toThrow(TypeError)
    expect(() => renderOgCard({ title: "x", theme: { background: "url(#x)" } })).toThrow(TypeError)
  })
})

describe("normalizeCardText", () => {
  it("replaces keyboard symbols that common fonts lack", () => {
    expect(normalizeCardText("⌘K")).toBe("Cmd+K")
    expect(normalizeCardText("⇧⌘P")).toBe("Shift+Cmd+P")
  })
  it("collapses whitespace", () => {
    expect(normalizeCardText("  a\n\n b ")).toBe("a b")
  })
})
