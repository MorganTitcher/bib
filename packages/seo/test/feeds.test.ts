import { describe, expect, it } from "vitest"
import { buildAtom, buildRss, type FeedInput, rfc822 } from "../src/feeds.ts"

const base: FeedInput = {
  title: "News & notes",
  siteUrl: "https://example.com/",
  feedUrl: "https://example.com/feed.xml",
  author: { name: "Team" },
  items: [
    { title: "Older", url: "https://example.com/older", published: "2026-01-01" },
    {
      title: "Newer <b>",
      url: "https://example.com/newer",
      published: "2026-02-01",
      summary: "Short & sweet",
      contentHtml: "<p>Body ]]> end</p>",
      categories: ["a&b"],
    },
  ],
}

describe("rfc822", () => {
  it("formats in GMT", () => {
    expect(rfc822("2026-10-11")).toBe("Sun, 11 Oct 2026 00:00:00 GMT")
  })
})

describe("buildRss", () => {
  it("escapes, sorts newest first and wraps content in CDATA", () => {
    const xml = buildRss(base)
    expect(xml).toContain("<title>News &amp; notes</title>")
    expect(xml.indexOf("Newer")).toBeLessThan(xml.indexOf("Older"))
    expect(xml).toContain("<title>Newer &lt;b&gt;</title>")
    expect(xml).toContain("<![CDATA[<p>Body ]]]]><![CDATA[> end</p>]]>")
    expect(xml).toContain('<guid isPermaLink="true">https://example.com/newer</guid>')
    expect(xml).toContain("<lastBuildDate>Sun, 01 Feb 2026 00:00:00 GMT</lastBuildDate>")
  })

  it("limits items and marks non-URL ids", () => {
    const xml = buildRss({
      ...base,
      limit: 1,
      items: [
        { title: "Tagged", url: "https://example.com/t", published: "2026-03-01", id: "tag:1" },
        ...base.items,
      ],
    })
    expect(xml).toContain('<guid isPermaLink="false">tag:1</guid>')
    expect(() => buildRss({ ...base, limit: -1 })).toThrow()
  })

  it("requires an updated date for an empty feed", () => {
    expect(() => buildRss({ ...base, items: [] })).toThrow(/updated/)
    expect(buildRss({ ...base, items: [], updated: "2026-01-01" })).toContain("<lastBuildDate>")
  })

  it("rejects relative URLs, blank titles and bad dates", () => {
    expect(() => buildRss({ ...base, siteUrl: "/" })).toThrow()
    expect(() =>
      buildRss({ ...base, items: [{ title: " ", url: "https://e.com", published: "2026-01-01" }] }),
    ).toThrow()
    expect(() =>
      buildRss({ ...base, items: [{ title: "x", url: "https://e.com", published: "nope" }] }),
    ).toThrow()
  })
})

describe("buildAtom", () => {
  it("escapes HTML content and uses RFC 3339 dates", () => {
    const xml = buildAtom(base)
    expect(xml).toContain('<content type="html">&lt;p&gt;Body ]]&gt; end&lt;/p&gt;</content>')
    expect(xml).toContain("<updated>2026-02-01T00:00:00.000Z</updated>")
    expect(xml).toContain('<category term="a&amp;b"/>')
  })

  it("never lets updated precede published", () => {
    const xml = buildAtom({
      ...base,
      items: [
        { title: "x", url: "https://e.com/x", published: "2026-05-01", updated: "2026-01-01" },
      ],
    })
    expect(xml).toContain("<updated>2026-05-01T00:00:00.000Z</updated>")
  })

  it("requires an author", () => {
    const { author: _a, ...noAuthor } = base
    expect(() => buildAtom(noAuthor)).toThrow(/author/)
  })
})
