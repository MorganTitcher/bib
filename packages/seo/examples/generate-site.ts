/**
 * Generate the SEO files for a small sample site with @bib/seo: robots.txt,
 * sitemap.xml, llms.txt, RSS and Atom feeds, security.txt, the IndexNow key
 * file and payload, and a page <head> (meta tags + JSON-LD). The generated head
 * is then audited, and a before/after CTR comparison is run.
 *
 * Run after building:
 *   pnpm --filter @bib/seo build
 *   node packages/seo/examples/generate-site.ts [outDir]
 *
 * With `outDir`, files are written there; otherwise a summary is printed.
 * A fixed clock keeps the output deterministic. Expected output is listed in
 * the package README ("Runnable example").
 */

import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { auditPage, extractPageSnapshot } from "@bib/seo/audit"
import { buildAtom, buildRss, type FeedItem } from "@bib/seo/feeds"
import { compareCtr } from "@bib/seo/impact"
import { buildIndexNowPayloads, indexNowKeyFile } from "@bib/seo/indexnow"
import {
  breadcrumbList,
  faqPage,
  graph,
  jsonLdScriptTag,
  organization,
  webPage,
  webSite,
} from "@bib/seo/jsonld"
import { buildLlmsTxt } from "@bib/seo/llms-txt"
import { buildPageMetadata, renderMetaTags } from "@bib/seo/metadata"
import { buildRobotsTxt } from "@bib/seo/robots"
import { buildSecurityTxt } from "@bib/seo/security-txt"
import { buildSitemaps } from "@bib/seo/sitemap"

const NOW = new Date("2026-10-11T12:00:00Z")
const SITE = "https://example.com"
const outDir = process.argv[2]

const files = new Map<string, string>()

files.set(
  "robots.txt",
  buildRobotsTxt({ aiPolicy: "block-training", sitemaps: [`${SITE}/sitemap.xml`] }),
)

const pages = [
  { loc: `${SITE}/`, lastmod: "2026-10-01" },
  { loc: `${SITE}/pricing`, lastmod: "2026-09-20" },
  { loc: `${SITE}/blog/q&a-launch`, lastmod: "2026-10-10" },
]
// alwaysIndex: robots.txt points at one stable index, which lists the chunks.
const sitemaps = buildSitemaps(pages, { baseUrl: `${SITE}/`, alwaysIndex: true })
files.set("sitemap.xml", sitemaps.index ?? "")
for (const file of sitemaps.files) files.set(file.path, file.xml)

files.set(
  "llms.txt",
  buildLlmsTxt({
    title: "Example",
    summary: "Example makes planning tools for small teams.",
    baseUrl: SITE,
    sections: [
      { title: "Docs", links: [{ title: "Pricing", url: "/pricing", notes: "Plans and limits" }] },
    ],
    optional: [{ title: "Q&A launch post", url: "/blog/q&a-launch" }],
  }),
)

const items: FeedItem[] = [
  {
    title: "Q&A <launch>",
    url: `${SITE}/blog/q&a-launch`,
    published: "2026-10-10T09:00:00Z",
    summary: "What shipped, and why.",
  },
]
const feed = { title: "Example blog", siteUrl: SITE, items, author: { name: "Example team" } }
files.set("feed.xml", buildRss({ ...feed, feedUrl: `${SITE}/feed.xml` }))
files.set("atom.xml", buildAtom({ ...feed, feedUrl: `${SITE}/atom.xml` }))

const security = buildSecurityTxt(
  {
    contact: ["security@example.com"],
    expires: "2027-04-01T00:00:00Z",
    preferredLanguages: ["en"],
    canonical: [`${SITE}/.well-known/security.txt`],
  },
  NOW,
)
files.set(".well-known/security.txt", security.body)

const key = "a1b2c3d4e5f6a7b8"
const keyFile = indexNowKeyFile(key)
files.set(keyFile.path.replace(/^\//, ""), keyFile.body)
const indexNow = buildIndexNowPayloads({
  host: "example.com",
  key,
  urls: [...pages.map((p) => p.loc), "https://other.example/x"],
})

const meta = buildPageMetadata({
  title: "Pricing plans",
  titleTemplate: "%s | Example",
  description: "Simple monthly plans for teams of every size, with no setup fees or contracts.",
  siteUrl: SITE,
  siteName: "Example",
  path: "/pricing",
  locale: "en-US",
  images: [{ url: "/og/pricing.png", width: 1200, height: 630, alt: "Example pricing" }],
  alternates: [
    { hreflang: "en", href: "/pricing" },
    { hreflang: "x-default", href: "/pricing" },
  ],
})
const jsonLd = graph([
  organization({ name: "Example", url: SITE, id: `${SITE}/#org` }),
  webSite({ name: "Example", url: SITE, id: `${SITE}/#site` }),
  webPage({ name: "Pricing plans", url: `${SITE}/pricing` }),
  breadcrumbList([{ name: "Home", url: SITE }, { name: "Pricing" }]),
  faqPage([{ question: "Is there a </script> trap?", answer: "No, it is escaped." }]),
])
const head = `${renderMetaTags(meta)}\n${jsonLdScriptTag(jsonLd)}`
files.set("pricing.head.html", head)

const html = `<!doctype html><html lang="en"><head>${head}</head><body><h1>Pricing</h1></body></html>`
const issues = auditPage(extractPageSnapshot(html, `${SITE}/pricing`))

const ctr = compareCtr({ clicks: 120, impressions: 10_000 }, { clicks: 180, impressions: 10_000 })

if (outDir !== undefined) {
  for (const [path, body] of files) {
    const target = join(outDir, path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, body)
  }
  console.log(`wrote ${files.size} files to ${outDir}`)
}

for (const [path, body] of files) console.log(`${path.padEnd(28)} ${body.length} bytes`)
console.log(
  `robots.txt user-agent lines: ${(files.get("robots.txt") ?? "").match(/^User-agent:/gm)?.length}`,
)
console.log(`sitemap escapes &: ${(files.get("sitemap-1.xml") ?? "").includes("q&amp;a-launch")}`)
console.log(`JSON-LD </script> escaped: ${!head.includes("</script> trap")}`)
console.log(`metadata warnings: ${meta.warnings.length}`)
console.log(`security.txt warnings: ${security.warnings.length}`)
console.log(
  `IndexNow: ${indexNow.payloads.length} payload, ${indexNow.payloads[0]?.urlList.length} urls, ${indexNow.rejected.length} rejected`,
)
console.log(`audit issues: ${issues.map((i) => `${i.severity}:${i.code}`).join(", ") || "none"}`)
console.log(`CTR ${ctr.before} -> ${ctr.after}: ${ctr.verdict} (p=${ctr.pValue.toFixed(4)})`)
