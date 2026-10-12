import { describe, expect, it } from "vitest"
import {
  applyTitleTemplate,
  buildPageMetadata,
  checkLength,
  isValidHreflang,
  renderMetaTags,
  robotsContent,
} from "../src/metadata.ts"

const DESC =
  "A clear description of the page that is long enough to pass the length check comfortably."

describe("helpers", () => {
  it("checks lengths", () => {
    expect(checkLength(undefined, { min: 1, max: 5 })).toBe("missing")
    expect(checkLength("  ", { min: 1, max: 5 })).toBe("missing")
    expect(checkLength("ab", { min: 3, max: 5 })).toBe("too-short")
    expect(checkLength("abcdef", { min: 3, max: 5 })).toBe("too-long")
    expect(checkLength("abcd", { min: 3, max: 5 })).toBe("ok")
  })

  it("applies title templates", () => {
    expect(applyTitleTemplate("Pricing", "%s | Example")).toBe("Pricing | Example")
    expect(applyTitleTemplate("Example", "%s | Example", "Example")).toBe("Example")
    expect(applyTitleTemplate(" Pricing ", "no placeholder")).toBe("Pricing")
  })

  it("validates hreflang", () => {
    for (const ok of ["en", "en-GB", "en-gb", "EN", "zh-Hant-TW", "es-419", "x-default"])
      expect(isValidHreflang(ok)).toBe(true)
    for (const bad of ["english", "en_GB", "en-GBR", ""]) expect(isValidHreflang(bad)).toBe(false)
  })

  it("serializes robots directives", () => {
    expect(robotsContent({})).toBe("index, follow")
    expect(robotsContent({ index: false, maxImagePreview: "large", maxSnippet: -1 })).toBe(
      "noindex, follow, max-snippet:-1, max-image-preview:large",
    )
  })
})

describe("buildPageMetadata", () => {
  it("builds canonical, OG and twitter fields", () => {
    const m = buildPageMetadata({
      title: "Pricing plans",
      titleTemplate: "%s | Example",
      description: DESC,
      siteUrl: "https://example.com",
      path: "/pricing",
      siteName: "Example",
      locale: "en-US",
      images: [{ url: "/og.png", width: 1200, height: 630, alt: "Pricing" }],
      twitter: { site: "@example" },
      alternates: [
        { hreflang: "en", href: "/pricing" },
        { hreflang: "x-default", href: "/pricing" },
      ],
    })
    expect(m.title).toBe("Pricing plans | Example")
    expect(m.canonical).toBe("https://example.com/pricing")
    expect(m.openGraph["og:locale"]).toBe("en_US")
    expect(m.twitter["twitter:card"]).toBe("summary_large_image")
    expect(m.twitter["twitter:image"]).toBe("https://example.com/og.png")
    expect(m.warnings).toEqual([])
  })

  it("throws on an empty title", () => {
    expect(() => buildPageMetadata({ title: "  " })).toThrow()
  })

  it("collects warnings instead of throwing", () => {
    const m = buildPageMetadata({
      title: "Hi",
      path: "/x#frag",
      siteUrl: "https://example.com",
      alternates: [
        { hreflang: "en_US", href: "/en" },
        { hreflang: "de", href: "/de" },
        { hreflang: "DE", href: "/de2" },
      ],
      twitter: { site: "example" },
      images: ["/a.png"],
    })
    const w = m.warnings.join("\n")
    expect(w).toMatch(/title is too-short/)
    expect(w).toMatch(/description is missing/)
    expect(w).toMatch(/fragment/)
    expect(w).toMatch(/invalid hreflang "en_US"/)
    expect(w).toMatch(/duplicate hreflang "DE"/)
    expect(w).toMatch(/self-reference/)
    expect(w).toMatch(/x-default/)
    expect(w).toMatch(/@name/)
    expect(w).toMatch(/alt text/)
    expect(m.twitter["twitter:card"]).toBe("summary_large_image")
  })

  it("warns when a relative URL cannot be resolved", () => {
    const m = buildPageMetadata({ title: "A title that is fine", path: "/x" })
    expect(m.canonical).toBeUndefined()
    expect(m.warnings.join()).toMatch(/not absolute/)
  })
})

describe("renderMetaTags", () => {
  it("escapes values", () => {
    const html = renderMetaTags(
      buildPageMetadata({
        title: 'Q&A "quotes" <b>',
        description: DESC,
        siteUrl: "https://example.com",
        path: "/q",
        article: { tags: ["a&b"] },
      }),
    )
    expect(html).toContain("<title>Q&amp;A &quot;quotes&quot; &lt;b&gt;</title>")
    expect(html).toContain('<meta property="og:type" content="article">')
    expect(html).toContain('<meta property="article:tag" content="a&amp;b">')
    expect(html).not.toContain("<b>")
  })
})
