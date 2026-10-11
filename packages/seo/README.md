# @bib/seo

Framework-agnostic SEO tooling made of pure functions. It builds the files and
tags a site needs to be found:

- JSON-LD structured data, serialized so it is safe inside a script tag;
- page metadata: titles, descriptions, canonical URLs, Open Graph, Twitter
  cards and hreflang;
- sitemaps and sitemap indexes;
- robots.txt with a cited AI-crawler registry;
- llms.txt;
- RSS 2.0 and Atom feeds;
- IndexNow payloads;
- security.txt.

It also lints rendered pages, and compares search metrics before and after a
change using `@bib/shared/stats`.

Nothing in the package does I/O. Every function takes data and returns a
string or object, so you write the output to disk, serve it from a route, or
POST it yourself. Anything time-dependent takes a `now` argument.

## Importing

Every module is a subpath export:

```ts
import { buildSitemaps } from "@bib/seo/sitemap"
import { jsonLdScriptTag, organization } from "@bib/seo/jsonld"
```

The root `@bib/seo` barrel re-exports every public name explicitly.

The only runtime dependency is `@bib/shared`. Its `strings` module is used for
HTML escaping, `stats` for the significance tests and `hashing` for IndexNow
fingerprints.

## Maturity

The whole package is `experimental` (`"bib": { "maturity": "experimental" }`).
APIs may change.

| Module | Status | Ported from | Notes |
|---|---|---|---|
| `jsonld` | experimental | Inkwell + Haven marketing JSON-LD | Organization, WebSite, WebPage, Article/BlogPosting, Product/Offer, SoftwareApplication, FAQPage, BreadcrumbList, HowTo, Event, LocalBusiness; `@graph`; escapes `< > & U+2028 U+2029` |
| `metadata` | experimental | new (patterns from Inkwell + AdSights web) | Title template, length checks, canonical, OG, Twitter, hreflang validation, robots directives. Returns warnings, never throws on soft problems |
| `sitemap` | experimental | new + AdSights web freshness model | XML escaping, invalid-char stripping, 50k-URL chunking with index, image + hreflang extensions, hash-based `lastmod` carry-forward |
| `robots` | experimental | Inkwell AI-crawler constants + AdSights web robots | AI-crawler registry re-verified and cited on 2026-10-11; `allow-all` / `block-training` / `block-all` policies; RFC 9309 path validation |
| `llms-txt` | experimental | new (format from llmstxt.org) | Markdown escaping of link text, URL paren/space encoding, `## Optional` section |
| `feeds` | experimental | Inkwell blog/changelog RSS + AdSights web feed builder | RSS 2.0 with `atom:link` self, `content:encoded` CDATA; Atom 1.0 |
| `indexnow` | experimental | Inkwell IndexNow script | Key validation, key file, 10k-URL batching, host/scheme filtering, fingerprint diff to submit only changed URLs |
| `security-txt` | experimental | Inkwell shared security.txt | RFC 9116; `Expires` required and must be in the future; warns past one year |
| `audit` | experimental | new | Regex HTML snapshot plus per-page and site-wide lint: titles, descriptions, canonical, robots, lang, h1, alt, hreflang, JSON-LD parse, duplicates |
| `impact` | experimental | AdSights web SEO impact | CTR two-proportion z-test and daily Welch t-test with verdicts. Wraps `@bib/shared/stats` and does not reimplement it |
| `xml` | experimental | new | `escapeXml`, `cdata`, `stripInvalidXmlChars` |

## Usage

Each example below was run against the built package, and the output shown is
real.

### `jsonld`

```ts
import { faqPage, graph, jsonLdScriptTag, organization, serializeJsonLd } from "@bib/seo/jsonld"

serializeJsonLd(faqPage([{ question: "Does </script> break it?", answer: "No" }]))
// {"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question",
//  "name":"Does </script> break it?", ...}]}

jsonLdScriptTag(graph([organization({ name: "Example", url: "https://example.com" })]))
// <script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":
//  "Organization","name":"Example","url":"https://example.com"}]}</script>
```

On invalid input the builders throw `RangeError`. Examples:

- relative or non-http URLs;
- blank names;
- an empty FAQ;
- a breadcrumb item without a URL anywhere except last;
- a search template without `{search_term_string}`.

Optional fields that are `undefined` are dropped. `jsonLdScriptTag` accepts a
CSP `nonce`.

### `metadata`

```ts
import { applyTitleTemplate, buildPageMetadata, isValidHreflang, renderMetaTags } from "@bib/seo/metadata"

applyTitleTemplate("Pricing", "%s | Example") // "Pricing | Example"
isValidHreflang("en-GB") // true
isValidHreflang("en_GB") // false

const m = buildPageMetadata({ title: "Hi", siteUrl: "https://example.com", path: "/hi" })
m.canonical // "https://example.com/hi"
m.warnings
// [ "title is too-short (2 chars; aim for 10-60)",
//   "description is missing (0 chars; aim for 50-160)",
//   "no og:image; link previews will have no image" ]

renderMetaTags(buildPageMetadata({ title: 'Q&A "tips"', description: "x", siteUrl: "https://example.com", path: "/q" }))
// <title>Q&amp;A &quot;tips&quot;</title>
// <meta name="description" content="x">
// <link rel="canonical" href="https://example.com/q">
// <meta property="og:title" content="Q&amp;A &quot;tips&quot;"> ... (all values escaped)
```

`buildPageMetadata` returns a plain object, so you can map it onto your
framework's metadata API. Its hreflang handling:

- each tag is validated (case-insensitive, as BCP 47 is);
- duplicates are reported;
- it checks for a self-reference and an `x-default`.

### `sitemap`

```ts
import { buildSitemap, buildSitemaps, carryForwardLastmod } from "@bib/seo/sitemap"

buildSitemap([{ loc: "https://example.com/a?x=1&y=2", lastmod: "2026-10-01" }])
// <?xml version="1.0" encoding="UTF-8"?>
// <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
//   <url><loc>https://example.com/a?x=1&amp;y=2</loc><lastmod>2026-10-01</lastmod></url>
// </urlset>

const s = buildSitemaps(entries120k, { baseUrl: "https://example.com/" })
s.files.map((f) => [f.path, f.urlCount])
// [["sitemap-1.xml", 50000], ["sitemap-2.xml", 50000], ["sitemap-3.xml", 20000]]
s.index // <sitemapindex> listing the three, lastmod = newest entry per chunk

carryForwardLastmod(
  { "https://example.com/a": { hash: "h1", lastmod: "2026-01-01" } },
  { "https://example.com/a": "h1", "https://example.com/b": "h2" },
  new Date("2026-10-11T00:00:00Z"),
)
// a keeps 2026-01-01 (unchanged hash); b is new and gets now; changed: [b]; removed: []
```

`buildSitemap` throws in three cases:

- more than 50,000 URLs;
- a URL longer than 2,048 characters;
- output above 50 MB.

Use `buildSitemaps` to chunk the entries. Pass `alwaysIndex: true` to get a
stable `sitemap.xml` index even when there is only one chunk.

### `robots`

```ts
import { AI_CRAWLERS_REVIEWED, aiCrawlerTokens, buildRobotsTxt } from "@bib/seo/robots"

AI_CRAWLERS_REVIEWED // "2026-10-11"
aiCrawlerTokens("training")
// ["GPTBot", "ClaudeBot", "Google-Extended", "Applebot-Extended",
//  "meta-externalagent", "Amazonbot", "MistralAI-Training", "CCBot"]

buildRobotsTxt({
  groups: [{ userAgent: "*", disallow: ["/admin"] }],
  sitemaps: ["https://example.com/sitemap.xml"],
})
// User-agent: *
// Disallow: /admin
//
// Sitemap: https://example.com/sitemap.xml

buildRobotsTxt({ aiPolicy: "block-training" })
// adds an allow group for search/user-fetch bots and a disallow group for training bots
```

Each entry in `AI_CRAWLERS` carries:

- the operator;
- its purpose (`training`, `search`, `user-fetch` or `ads`);
- the URL of the operator's own documentation.

The policies also disallow `UNVERIFIED_AI_CRAWLERS` (`Bytespider`, `YouBot`).
Their operators do not publish token documentation, and Bytespider is widely
reported to ignore robots.txt anyway. Pass `blockUnverified: false` to leave
them out.

### `llms-txt`

```ts
import { buildLlmsTxt } from "@bib/seo/llms-txt"

buildLlmsTxt({
  title: "Example",
  summary: "Planning tools.",
  baseUrl: "https://example.com",
  sections: [{ title: "Docs", links: [{ title: "API [v2]", url: "/docs/api (v2)", notes: "Reference" }] }],
})
// # Example
//
// > Planning tools.
//
// ## Docs
//
// - [API \[v2\]](https://example.com/docs/api%20%28v2%29): Reference
```

### `feeds`

```ts
import { buildAtom, buildRss } from "@bib/seo/feeds"

const feed = {
  title: "Blog",
  siteUrl: "https://example.com",
  feedUrl: "https://example.com/feed.xml",
  author: { name: "Team" },
  items: [{ title: "Q&A", url: "https://example.com/q", published: "2026-10-10T09:00:00Z", contentHtml: "<p>a ]]> b</p>" }],
}
buildRss(feed)
// ... <title>Q&amp;A</title> ... <pubDate>Sat, 10 Oct 2026 09:00:00 GMT</pubDate>
// <content:encoded><![CDATA[<p>a ]]]]><![CDATA[> b</p>]]></content:encoded>
buildAtom({ ...feed, feedUrl: "https://example.com/atom.xml" }) // Atom 1.0
```

Items are sorted newest first. `limit` keeps the newest N. `buildAtom` throws
unless there is a feed author or an author on every entry, because Atom
requires one.

### `indexnow`

```ts
import { buildIndexNowPayloads, indexNowKeyFile, isValidIndexNowKey } from "@bib/seo/indexnow"

isValidIndexNowKey("short") // false (8-128 of [A-Za-z0-9-])
indexNowKeyFile("a1b2c3d4e5f6a7b8")
// { path: "/a1b2c3d4e5f6a7b8.txt", body: "a1b2c3d4e5f6a7b8", contentType: "text/plain; charset=utf-8" }

buildIndexNowPayloads({
  host: "example.com",
  key: "a1b2c3d4e5f6a7b8",
  urls: ["https://example.com/a", "http://example.com/b", "https://other.com/c"],
})
// payloads: [{ host, key, urlList: ["https://example.com/a"] }]
// rejected: [{ url: "http://example.com/b", reason: "not-https" },
//            { url: "https://other.com/c", reason: "wrong-host" }]
```

POST each payload as JSON to `INDEXNOW_ENDPOINT` yourself. To find what to
submit, use `diffIndexNowManifest` (async). It fingerprints each URL with a
content revision and returns only the URLs that are new or changed.

### `security-txt`

```ts
import { buildSecurityTxt } from "@bib/seo/security-txt"

const sec = buildSecurityTxt(
  { contact: ["security@example.com"], expires: "2028-01-01T00:00:00Z" },
  new Date("2026-10-11T00:00:00Z"),
)
sec.body
// Contact: mailto:security@example.com
// Expires: 2028-01-01T00:00:00.000Z
sec.warnings // ["Expires is more than a year away; RFC 9116 recommends less than a year"]
sec.path     // "/.well-known/security.txt"

buildSecurityTxt({ contact: ["security@example.com"], expires: "2026-01-01" }, now)
// throws RangeError: Expires must be in the future
```

The function throws in three cases:

- no contact;
- a contact that is not a `mailto:`, `https:` or `tel:` URI;
- an expired date.

A bare email gets `mailto:` added.

### `audit`

```ts
import { auditPage, auditSite, extractPageSnapshot } from "@bib/seo/audit"

const page = extractPageSnapshot(
  '<html><head><title>Home</title></head><body><h1>A</h1><h1>B</h1><img src="/x.png"></body></html>',
  "https://example.com/",
)
auditPage(page).map((i) => `${i.severity} ${i.code}`)
// ["warning title-too-short", "warning description-missing", "warning canonical-missing",
//  "warning lang-missing", "warning img-alt-missing", "info h1-multiple",
//  "info og-title-missing", "info og-image-missing"]

auditSite([page, { ...page, url: "https://example.com/other" }])
// per-page issues for both, plus "warning title-duplicate" across the two URLs
```

Each issue has a `code`, a `severity` (`error`, `warning` or `info`), a
`message` and the `urls` it applies to.

The audit is regex-based and does not need a DOM, so it runs anywhere. It flags
these as errors:

- a missing title;
- a relative canonical;
- an invalid or duplicate hreflang;
- an unparseable JSON-LD block;
- non-reciprocal hreflang across pages (site-wide only).

### `impact`

```ts
import { compareCtr, compareDailyValues, splitAroundChange } from "@bib/seo/impact"

compareCtr({ clicks: 120, impressions: 10000 }, { clicks: 180, impressions: 10000 })
// { before: 0.012, after: 0.018, change: 0.006, relativeChange: 0.5,
//   statistic: 3.49, pValue: 0.00048, verdict: "improved" }

const { before, after } = splitAroundChange(dailySeries, "2026-09-15", 14)
compareDailyValues(before, after).verdict // "improved"
```

The verdict is `insufficient-data` when either side is too small:

- for CTR, fewer than 10 clicks or 10 non-clicks;
- for daily values, fewer than `minDays` days (default 7).

The day of the change itself is excluded from both windows. Pass
`direction: "lower-is-better"` for metrics like average position.

### `xml`

```ts
import { cdata, escapeXml } from "@bib/seo/xml"

escapeXml("Q&A <b> \u0007") // "Q&amp;A &lt;b&gt; " (control char stripped)
cdata("a ]]> b")            // "<![CDATA[a ]]]]><![CDATA[> b]]>"
```

## Runnable example

[`examples/generate-site.ts`](./examples/generate-site.ts) generates the files
for a small sample site:

- robots.txt;
- a sitemap index plus its chunk;
- llms.txt;
- RSS and Atom feeds;
- security.txt;
- the IndexNow key file;
- a pricing-page `<head>` with meta tags and a JSON-LD graph.

It then audits that head and runs a CTR comparison. The clock is fixed, so the
output is deterministic.

```sh
pnpm --filter @bib/seo build
node packages/seo/examples/generate-site.ts          # print a summary
node packages/seo/examples/generate-site.ts out/seo  # also write the files to out/seo
```

Expected output (the second form also prints `wrote 9 files to out/seo` first):

```
robots.txt                   855 bytes
sitemap.xml                  217 bytes
sitemap-1.xml                358 bytes
llms.txt                     199 bytes
feed.xml                     817 bytes
atom.xml                     760 bytes
.well-known/security.txt     151 bytes
a1b2c3d4e5f6a7b8.txt         16 bytes
pricing.head.html            2054 bytes
robots.txt user-agent lines: 26
sitemap escapes &: true
JSON-LD </script> escaped: true
metadata warnings: 0
security.txt warnings: 0
IndexNow: 1 payload, 3 urls, 1 rejected
audit issues: none
CTR 0.012 -> 0.018: improved (p=0.0005)
```

## Not yet / limits

- **The audit reads HTML with regexes, not a DOM.** It audits the HTML string
  you pass it, so content injected by client-side JavaScript is invisible.
  Unusual markup, such as attributes split across lines in odd ways, can be
  missed. To audit a client-rendered page, pass its fully rendered HTML.
- **Length checks count characters, not pixels.** Search engines truncate
  titles and descriptions by pixel width, so the 60 and 160 character limits
  are heuristics.
- **No video or news sitemap extensions.** Image and hreflang extensions are
  supported.
- **No network I/O.** IndexNow payloads are built but not sent. Feeds and
  sitemaps are returned as strings, not written or served.
- **The AI-crawler registry is a dated snapshot.** It was verified on
  2026-10-11 (`AI_CRAWLERS_REVIEWED`). Operators add and rename tokens, so
  re-check the cited sources periodically. robots.txt is advisory: it does not
  stop crawlers that ignore it.
- **The impact functions are observational.** A significant before/after
  difference does not prove the change caused it, because seasonality, ranking
  updates and other deploys can confound it. The CTR minimum-count rule and
  the 7-day minimum are heuristics. A large impression count makes even a tiny
  change significant, so look at the effect size as well as the p-value.
- **JSON-LD builders cover common types only.** Each builder covers a common
  subset of its schema.org type. For other properties, use `graph` with
  hand-written nodes; serialization is still escaped. The builders do not
  check Google's rich-result eligibility rules.
- **llms.txt is not a standard.** It follows the llmstxt.org proposal, which
  crawlers are not obliged to read.
