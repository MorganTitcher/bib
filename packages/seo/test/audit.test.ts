import { describe, expect, it } from "vitest"
import { auditPage, auditSite, extractPageSnapshot } from "../src/audit.ts"

const HTML = `<!doctype html><html lang="en"><head>
<title>Pricing plans &amp; options | Example</title>
<meta name="description" content="Compare plans, see what each includes, and pick the one that fits your team.">
<link rel="canonical" href="https://example.com/pricing">
<link rel="alternate" hreflang="en" href="https://example.com/pricing">
<link rel="alternate" hreflang="x-default" href="https://example.com/pricing">
<meta property="og:title" content="Pricing">
<meta property="og:image" content="https://example.com/og.png">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"WebPage"}</script>
<!-- <title>ignored</title> -->
</head><body><h1>Pricing <em>plans</em></h1><img src="/a.png" alt="Chart"></body></html>`

describe("extractPageSnapshot", () => {
  it("pulls the facts out of HTML", () => {
    const page = extractPageSnapshot(HTML, "https://example.com/pricing")
    expect(page.title).toBe("Pricing plans & options | Example")
    expect(page.canonical).toBe("https://example.com/pricing")
    expect(page.lang).toBe("en")
    expect(page.h1).toEqual(["Pricing plans"])
    expect(page.images).toEqual([{ src: "/a.png", alt: "Chart" }])
    expect(page.alternates).toHaveLength(2)
    expect(page.jsonLd).toHaveLength(1)
    expect(page.openGraph["og:title"]).toBe("Pricing")
  })

  it("a clean page has no issues", () => {
    expect(auditPage(extractPageSnapshot(HTML, "https://example.com/pricing"))).toEqual([])
  })
})

describe("auditPage", () => {
  it("reports missing and malformed fields, errors first", () => {
    const html = `<html><head><link rel="canonical" href="/rel"><script type="application/ld+json">{bad</script></head>
<body><h1></h1><h1>Two</h1><img src="x.png"></body></html>`
    const issues = auditPage(extractPageSnapshot(html, "https://example.com/x"))
    const codes = issues.map((i) => i.code)
    for (const code of [
      "title-missing",
      "canonical-relative",
      "jsonld-invalid",
      "description-missing",
      "lang-missing",
      "img-alt-missing",
      "h1-multiple",
    ]) {
      expect(codes).toContain(code)
    }
    expect(issues[0]?.severity).toBe("error")
  })

  it("checks hreflang validity and self-reference", () => {
    const issues = auditPage({
      url: "https://example.com/a",
      title: "A reasonable page title",
      h1: ["A"],
      images: [],
      jsonLd: [],
      openGraph: {},
      alternates: [
        { hreflang: "english", href: "https://example.com/en" },
        { hreflang: "de", href: "https://example.com/de" },
        { hreflang: "de", href: "https://example.com/de2" },
      ],
    })
    const codes = issues.map((i) => i.code)
    expect(codes).toEqual(
      expect.arrayContaining([
        "hreflang-invalid",
        "hreflang-duplicate",
        "hreflang-no-self",
        "hreflang-no-x-default",
      ]),
    )
  })
})

describe("auditSite", () => {
  it("finds duplicate titles and missing hreflang return links", () => {
    const page = (url: string, alternates: { hreflang: string; href: string }[] = []) => ({
      url,
      title: "Same title for both pages",
      h1: ["x"],
      images: [],
      jsonLd: [],
      openGraph: {},
      alternates,
    })
    const issues = auditSite([
      page("https://example.com/en", [
        { hreflang: "en", href: "https://example.com/en" },
        { hreflang: "de", href: "https://example.com/de" },
      ]),
      page("https://example.com/de"),
    ])
    const dup = issues.find((i) => i.code === "title-duplicate")
    expect(dup?.urls).toEqual(["https://example.com/en", "https://example.com/de"])
    expect(issues.some((i) => i.code === "hreflang-no-return")).toBe(true)
  })

  it("ignores noindex pages for duplicate checks", () => {
    const p = {
      title: "Same title for both pages",
      h1: ["x"],
      images: [],
      jsonLd: [],
      openGraph: {},
      alternates: [],
    }
    const issues = auditSite([
      { ...p, url: "https://example.com/a" },
      { ...p, url: "https://example.com/b", robots: "noindex, follow" },
    ])
    expect(issues.some((i) => i.code === "title-duplicate")).toBe(false)
  })
})
