import { describe, expect, it } from "vitest"
import {
  buildSitemap,
  buildSitemapIndex,
  buildSitemaps,
  carryForwardLastmod,
  resolveLastmod,
} from "../src/sitemap.ts"

describe("buildSitemap", () => {
  it("escapes values and only emits optional fields when given", () => {
    const xml = buildSitemap([{ loc: "https://example.com/?a=1&b=<2>", lastmod: "2026-10-01" }])
    expect(xml).toContain("<loc>https://example.com/?a=1&amp;b=&lt;2&gt;</loc>")
    expect(xml).toContain("<lastmod>2026-10-01</lastmod>")
    expect(xml).not.toContain("priority")
    expect(xml).not.toContain("xmlns:xhtml")
  })

  it("adds namespaces for alternates and images", () => {
    const xml = buildSitemap([
      {
        loc: "https://example.com/en",
        priority: 0.8,
        changefreq: "weekly",
        alternates: [{ hreflang: "de", href: "https://example.com/de" }],
        images: ["https://example.com/a.png"],
      },
    ])
    expect(xml).toContain('xmlns:xhtml="http://www.w3.org/1999/xhtml"')
    expect(xml).toContain('xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"')
    expect(xml).toContain(
      '<xhtml:link rel="alternate" hreflang="de" href="https://example.com/de"/>',
    )
    expect(xml).toContain("<priority>0.8</priority>")
  })

  it("produces a valid empty urlset", () => {
    expect(buildSitemap([])).toContain("<urlset")
  })

  it("rejects relative URLs, bad priority and bad dates", () => {
    expect(() => buildSitemap([{ loc: "/about" }])).toThrow(RangeError)
    expect(() => buildSitemap([{ loc: "https://example.com/", priority: 1.5 }])).toThrow(/priority/)
    expect(() => buildSitemap([{ loc: "https://example.com/", lastmod: "2026-02-31" }])).toThrow(
      /lastmod/,
    )
    expect(() => buildSitemap([{ loc: `https://example.com/${"a".repeat(2100)}` }])).toThrow(/2048/)
  })
})

describe("buildSitemaps", () => {
  const entries = Array.from({ length: 5 }, (_, i) => ({
    loc: `https://example.com/p${i}`,
    lastmod: `2026-0${i + 1}-01`,
  }))

  it("chunks and indexes with the newest lastmod per chunk", () => {
    const out = buildSitemaps(entries, { baseUrl: "https://example.com/", chunkSize: 2 })
    expect(out.files.map((f) => f.path)).toEqual([
      "sitemap-1.xml",
      "sitemap-2.xml",
      "sitemap-3.xml",
    ])
    expect(out.files.map((f) => f.urlCount)).toEqual([2, 2, 1])
    expect(out.index).toContain(
      "<loc>https://example.com/sitemap-1.xml</loc><lastmod>2026-02-01</lastmod>",
    )
    expect(out.index).toContain(
      "<loc>https://example.com/sitemap-3.xml</loc><lastmod>2026-05-01</lastmod>",
    )
  })

  it("skips the index for one chunk unless asked", () => {
    expect(buildSitemaps(entries, { baseUrl: "https://example.com/" }).index).toBeUndefined()
    expect(
      buildSitemaps(entries, { baseUrl: "https://example.com/", alwaysIndex: true }).index,
    ).toBeDefined()
  })

  it("validates options", () => {
    expect(() =>
      buildSitemaps(entries, { baseUrl: "https://example.com/", chunkSize: 0 }),
    ).toThrow()
    expect(() =>
      buildSitemaps(entries, { baseUrl: "https://example.com/", chunkSize: 50_001 }),
    ).toThrow()
    expect(() => buildSitemaps(entries, { baseUrl: "/", chunkSize: 2 })).toThrow()
    expect(() =>
      buildSitemaps(entries, { baseUrl: "https://example.com/", fileName: "map.xml" }),
    ).toThrow(/\{n\}/)
  })
})

describe("buildSitemapIndex", () => {
  it("escapes and omits missing lastmod", () => {
    const xml = buildSitemapIndex([{ loc: "https://example.com/a.xml?x=1&y=2" }])
    expect(xml).toContain("<sitemap><loc>https://example.com/a.xml?x=1&amp;y=2</loc></sitemap>")
  })
})

describe("resolveLastmod", () => {
  it("takes the latest valid date and ignores impossible ones", () => {
    expect(resolveLastmod({ published: "2026-03-01", modified: "2026-01-01" })).toBe("2026-03-01")
    expect(
      resolveLastmod({ published: "2026-03-01", modified: "2026-04-01", floor: "2026-02-01" }),
    ).toBe("2026-04-01")
    expect(resolveLastmod({ published: "2026-02-31" })).toBeUndefined()
    expect(resolveLastmod({})).toBeUndefined()
  })
})

describe("carryForwardLastmod", () => {
  it("keeps dates for unchanged hashes and stamps changed or new URLs", () => {
    const previous = {
      "https://example.com/a": { hash: "h1", lastmod: "2026-01-01" },
      "https://example.com/b": { hash: "h2", lastmod: "2026-01-01" },
      "https://example.com/gone": { hash: "h3", lastmod: "2026-01-01" },
    }
    const out = carryForwardLastmod(
      previous,
      {
        "https://example.com/a": "h1",
        "https://example.com/b": "changed",
        "https://example.com/new": "h4",
      },
      "2026-10-11",
    )
    expect(out.manifest["https://example.com/a"]?.lastmod).toBe("2026-01-01")
    expect(out.manifest["https://example.com/b"]?.lastmod).toBe("2026-10-11")
    expect(out.changed).toEqual(["https://example.com/b", "https://example.com/new"])
    expect(out.removed).toEqual(["https://example.com/gone"])
  })

  it("rejects an invalid now", () => {
    expect(() => carryForwardLastmod({}, {}, "nope")).toThrow(RangeError)
  })
})
