/**
 * RSS 2.0 and Atom 1.0 (RFC 4287) feed builders.
 *
 * Text is XML-escaped; HTML content goes in CDATA (RSS `content:encoded`) or an
 * escaped `type="html"` element (Atom), and invalid XML characters are
 * stripped. Items are sorted newest first. RSS dates use RFC 822
 * (`Sun, 11 Oct 2026 00:00:00 GMT`); Atom dates use RFC 3339.
 */

import { type DateInput, isAbsoluteHttpUrl, toInstant } from "./internal.ts"
import { cdata, escapeXml } from "./xml.ts"

export interface FeedItem {
  readonly title: string
  /** Absolute URL of the item. */
  readonly url: string
  readonly published: DateInput
  readonly updated?: DateInput
  /** Stable unique id. Defaults to `url` (a permalink). */
  readonly id?: string
  /** Plain-text summary. */
  readonly summary?: string
  /** Full HTML content. */
  readonly contentHtml?: string
  readonly author?: { readonly name: string; readonly email?: string }
  readonly categories?: readonly string[]
  readonly image?: { readonly url: string; readonly type: string; readonly length?: number }
}

export interface FeedInput {
  readonly title: string
  /** Absolute URL of the site the feed describes. */
  readonly siteUrl: string
  /** Absolute URL the feed itself is served from (self link). */
  readonly feedUrl: string
  readonly description?: string
  readonly language?: string
  readonly items: readonly FeedItem[]
  readonly author?: { readonly name: string; readonly email?: string }
  /** Overrides the newest item date as the feed's updated time. */
  readonly updated?: DateInput
  readonly copyright?: string
  /** Truncate to the newest N items. */
  readonly limit?: number
}

function url(value: string, field: string): string {
  if (!isAbsoluteHttpUrl(value))
    throw new RangeError(`${field}: expected an absolute http(s) URL, got ${value}`)
  return value
}

function sortedItems(input: FeedInput): { item: FeedItem; published: Date; updated: Date }[] {
  const items = input.items.map((item, i) => {
    if (item.title.trim() === "") throw new RangeError(`feed item ${i}: title must not be blank`)
    url(item.url, `feed item ${i}.url`)
    const published = toInstant(item.published, `feed item ${i}.published`)
    const updated =
      item.updated === undefined ? published : toInstant(item.updated, `feed item ${i}.updated`)
    return { item, published, updated: updated < published ? published : updated }
  })
  items.sort((a, b) => b.published.getTime() - a.published.getTime())
  if (input.limit !== undefined) {
    if (!Number.isInteger(input.limit) || input.limit < 0)
      throw new RangeError("limit must be a non-negative integer")
    return items.slice(0, input.limit)
  }
  return items
}

function feedUpdated(input: FeedInput, items: { updated: Date }[]): Date {
  if (input.updated !== undefined) return toInstant(input.updated, "updated")
  let newest = 0
  for (const i of items) newest = Math.max(newest, i.updated.getTime())
  if (newest === 0) throw new RangeError("a feed with no items needs an explicit `updated` date")
  return new Date(newest)
}

/** RFC 822 date as RSS requires, always in GMT. */
export function rfc822(date: DateInput): string {
  return toInstant(date, "date").toUTCString()
}

/** Build an RSS 2.0 feed with `atom:link rel="self"` and `content:encoded`. */
export function buildRss(input: FeedInput): string {
  const items = sortedItems(input)
  const updated = feedUpdated(input, items)
  const channel = [
    `<title>${escapeXml(input.title)}</title>`,
    `<link>${escapeXml(url(input.siteUrl, "siteUrl"))}</link>`,
    `<description>${escapeXml(input.description ?? input.title)}</description>`,
    `<atom:link href="${escapeXml(url(input.feedUrl, "feedUrl"))}" rel="self" type="application/rss+xml"/>`,
    input.language ? `<language>${escapeXml(input.language)}</language>` : "",
    input.copyright ? `<copyright>${escapeXml(input.copyright)}</copyright>` : "",
    `<lastBuildDate>${updated.toUTCString()}</lastBuildDate>`,
  ].filter(Boolean)
  const body = items.map(({ item, published }) => {
    const id = item.id ?? item.url
    const parts = [
      `<title>${escapeXml(item.title)}</title>`,
      `<link>${escapeXml(item.url)}</link>`,
      `<guid isPermaLink="${id === item.url}">${escapeXml(id)}</guid>`,
      `<pubDate>${published.toUTCString()}</pubDate>`,
    ]
    if (item.summary) parts.push(`<description>${escapeXml(item.summary)}</description>`)
    if (item.contentHtml)
      parts.push(`<content:encoded>${cdata(item.contentHtml)}</content:encoded>`)
    // RSS <author> must be an email; the name-only form goes in dc:creator.
    if (item.author) parts.push(`<dc:creator>${escapeXml(item.author.name)}</dc:creator>`)
    for (const c of item.categories ?? []) parts.push(`<category>${escapeXml(c)}</category>`)
    if (item.image) {
      parts.push(
        `<enclosure url="${escapeXml(url(item.image.url, "image.url"))}" type="${escapeXml(item.image.type)}" length="${item.image.length ?? 0}"/>`,
      )
    }
    return `    <item>\n      ${parts.join("\n      ")}\n    </item>`
  })
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/">',
    "  <channel>",
    ...channel.map((c) => `    ${c}`),
    ...body,
    "  </channel>",
    "</rss>",
    "",
  ].join("\n")
}

function atomPerson(tag: string, p: { name: string; email?: string } | undefined): string {
  if (p === undefined) return ""
  const email = p.email ? `<email>${escapeXml(p.email)}</email>` : ""
  return `<${tag}><name>${escapeXml(p.name)}</name>${email}</${tag}>`
}

/**
 * Build an Atom 1.0 feed. Atom requires an author on the feed or on every
 * entry; this throws when neither is present.
 */
export function buildAtom(input: FeedInput): string {
  const items = sortedItems(input)
  const updated = feedUpdated(input, items)
  if (input.author === undefined && items.some(({ item }) => item.author === undefined)) {
    throw new RangeError("Atom requires a feed author or an author on every entry")
  }
  const head = [
    `<id>${escapeXml(url(input.feedUrl, "feedUrl"))}</id>`,
    `<title>${escapeXml(input.title)}</title>`,
    input.description ? `<subtitle>${escapeXml(input.description)}</subtitle>` : "",
    `<updated>${updated.toISOString()}</updated>`,
    `<link rel="self" type="application/atom+xml" href="${escapeXml(input.feedUrl)}"/>`,
    `<link rel="alternate" type="text/html" href="${escapeXml(url(input.siteUrl, "siteUrl"))}"/>`,
    atomPerson("author", input.author),
    input.copyright ? `<rights>${escapeXml(input.copyright)}</rights>` : "",
  ].filter(Boolean)
  const entries = items.map(({ item, published, updated: u }) => {
    const parts = [
      `<id>${escapeXml(item.id ?? item.url)}</id>`,
      `<title>${escapeXml(item.title)}</title>`,
      `<link rel="alternate" type="text/html" href="${escapeXml(item.url)}"/>`,
      `<published>${published.toISOString()}</published>`,
      `<updated>${u.toISOString()}</updated>`,
      atomPerson("author", item.author),
    ]
    if (item.summary) parts.push(`<summary>${escapeXml(item.summary)}</summary>`)
    if (item.contentHtml)
      parts.push(`<content type="html">${escapeXml(item.contentHtml)}</content>`)
    for (const c of item.categories ?? []) parts.push(`<category term="${escapeXml(c)}"/>`)
    return `  <entry>\n    ${parts.filter(Boolean).join("\n    ")}\n  </entry>`
  })
  const lang = input.language ? ` xml:lang="${escapeXml(input.language)}"` : ""
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<feed xmlns="http://www.w3.org/2005/Atom"${lang}>`,
    ...head.map((h) => `  ${h}`),
    ...entries,
    "</feed>",
    "",
  ].join("\n")
}
