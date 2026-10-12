/**
 * XML sitemaps (sitemaps.org protocol 0.9): url sets, sitemap indexes,
 * chunking at the protocol limits, and honest `<lastmod>` values.
 *
 * Limits enforced: 50,000 URLs and 50 MB (52,428,800 bytes, uncompressed) per
 * file, URLs under 2,048 characters, absolute http(s) URLs only. Values are
 * XML-escaped. Google ignores `<priority>` and `<changefreq>`; they are emitted
 * only when you pass them.
 *
 * `lastmod` should change only when the page content meaningfully changes. Two
 * helpers support that: {@link resolveLastmod} for authored dates (modified never
 * precedes published) and {@link carryForwardLastmod} for content fingerprints
 * (the date moves only when the hash changes).
 */

import { escapeXml } from "@bib/shared/xml"
import { type DateInput, isAbsoluteHttpUrl, normalizeDate } from "./internal.ts"

export const SITEMAP_MAX_URLS = 50_000
export const SITEMAP_MAX_BYTES = 52_428_800
export const SITEMAP_MAX_URL_LENGTH = 2_048

export type ChangeFreq = "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never"

export interface SitemapAlternate {
  readonly hreflang: string
  readonly href: string
}

export interface SitemapEntry {
  readonly loc: string
  readonly lastmod?: DateInput
  readonly changefreq?: ChangeFreq
  /** 0.0 to 1.0. */
  readonly priority?: number
  /** hreflang alternates, emitted as `<xhtml:link rel="alternate">`. */
  readonly alternates?: readonly SitemapAlternate[]
  /** Image URLs, emitted with the Google image extension. */
  readonly images?: readonly string[]
}

const encoder = new TextEncoder()

function checkLoc(loc: string, field: string): void {
  if (!isAbsoluteHttpUrl(loc))
    throw new RangeError(`${field}: expected an absolute http(s) URL, got ${loc}`)
  if (loc.length >= SITEMAP_MAX_URL_LENGTH)
    throw new RangeError(`${field}: URL must be under ${SITEMAP_MAX_URL_LENGTH} characters`)
}

function lastmodTag(value: DateInput | undefined, loc: string): string {
  if (value === undefined) return ""
  const normalized = normalizeDate(value)
  if (normalized === undefined)
    throw new RangeError(`lastmod for ${loc}: invalid date ${String(value)}`)
  return `<lastmod>${normalized}</lastmod>`
}

function urlXml(entry: SitemapEntry): string {
  checkLoc(entry.loc, "loc")
  const parts = [`<loc>${escapeXml(entry.loc)}</loc>`, lastmodTag(entry.lastmod, entry.loc)]
  if (entry.changefreq !== undefined) parts.push(`<changefreq>${entry.changefreq}</changefreq>`)
  if (entry.priority !== undefined) {
    if (!(entry.priority >= 0 && entry.priority <= 1))
      throw new RangeError(`priority for ${entry.loc} must be within [0, 1]`)
    parts.push(`<priority>${entry.priority.toFixed(1)}</priority>`)
  }
  for (const alt of entry.alternates ?? []) {
    checkLoc(alt.href, `alternate ${alt.hreflang}`)
    parts.push(
      `<xhtml:link rel="alternate" hreflang="${escapeXml(alt.hreflang)}" href="${escapeXml(alt.href)}"/>`,
    )
  }
  for (const img of entry.images ?? []) {
    checkLoc(img, "image")
    parts.push(`<image:image><image:loc>${escapeXml(img)}</image:loc></image:image>`)
  }
  return `<url>${parts.join("")}</url>`
}

/**
 * Build one `<urlset>` document. Throws when the entries exceed 50,000 URLs or
 * 50 MB — use {@link buildSitemaps} to chunk large sets.
 */
export function buildSitemap(entries: readonly SitemapEntry[]): string {
  if (entries.length > SITEMAP_MAX_URLS) {
    throw new RangeError(
      `a sitemap holds at most ${SITEMAP_MAX_URLS} URLs; got ${entries.length} (use buildSitemaps)`,
    )
  }
  const needsXhtml = entries.some((e) => (e.alternates?.length ?? 0) > 0)
  const needsImage = entries.some((e) => (e.images?.length ?? 0) > 0)
  const ns = [
    'xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"',
    needsXhtml ? 'xmlns:xhtml="http://www.w3.org/1999/xhtml"' : "",
    needsImage ? 'xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"' : "",
  ]
    .filter(Boolean)
    .join(" ")
  const body = entries.map((e) => `  ${urlXml(e)}`).join("\n")
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset ${ns}>\n${body}${body ? "\n" : ""}</urlset>\n`
  if (encoder.encode(xml).length > SITEMAP_MAX_BYTES)
    throw new RangeError("sitemap exceeds 50 MB uncompressed (use buildSitemaps)")
  return xml
}

export interface SitemapIndexEntry {
  readonly loc: string
  readonly lastmod?: DateInput
}

/** Build a `<sitemapindex>` document (at most 50,000 child sitemaps). */
export function buildSitemapIndex(sitemaps: readonly SitemapIndexEntry[]): string {
  if (sitemaps.length > SITEMAP_MAX_URLS)
    throw new RangeError(`a sitemap index holds at most ${SITEMAP_MAX_URLS} sitemaps`)
  const body = sitemaps
    .map((s) => {
      checkLoc(s.loc, "sitemap loc")
      return `  <sitemap><loc>${escapeXml(s.loc)}</loc>${lastmodTag(s.lastmod, s.loc)}</sitemap>`
    })
    .join("\n")
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}${body ? "\n" : ""}</sitemapindex>\n`
}

export interface ChunkedSitemaps {
  /** One `{ path, xml }` per chunk, e.g. `sitemap-1.xml`. */
  readonly files: readonly {
    readonly path: string
    readonly xml: string
    readonly urlCount: number
  }[]
  /** The index referencing every chunk. `undefined` when one file is enough and `alwaysIndex` is false. */
  readonly index?: string
}

export interface ChunkOptions {
  /** Absolute base the chunk files are served from, e.g. `https://example.com/`. */
  readonly baseUrl: string
  /** Max URLs per chunk (default and ceiling 50,000). */
  readonly chunkSize?: number
  /** File name pattern; `{n}` is the 1-based chunk number. Default `sitemap-{n}.xml`. */
  readonly fileName?: string
  /** Emit an index even for a single chunk. Default false. */
  readonly alwaysIndex?: boolean
}

/**
 * Split entries into sitemap files of at most `chunkSize` URLs and build an
 * index whose `<lastmod>` per chunk is the newest entry date in that chunk.
 */
export function buildSitemaps(
  entries: readonly SitemapEntry[],
  options: ChunkOptions,
): ChunkedSitemaps {
  const size = options.chunkSize ?? SITEMAP_MAX_URLS
  if (!Number.isInteger(size) || size < 1 || size > SITEMAP_MAX_URLS) {
    throw new RangeError(`chunkSize must be an integer in [1, ${SITEMAP_MAX_URLS}]`)
  }
  if (!isAbsoluteHttpUrl(options.baseUrl))
    throw new RangeError("baseUrl must be an absolute http(s) URL")
  const pattern = options.fileName ?? "sitemap-{n}.xml"
  if (!pattern.includes("{n}")) throw new RangeError("fileName must contain {n}")
  const files: { path: string; xml: string; urlCount: number }[] = []
  const indexEntries: SitemapIndexEntry[] = []
  const chunkCount = Math.max(1, Math.ceil(entries.length / size))
  for (let i = 0; i < chunkCount; i++) {
    const chunk = entries.slice(i * size, (i + 1) * size)
    const path = pattern.replace("{n}", String(i + 1))
    files.push({ path, xml: buildSitemap(chunk), urlCount: chunk.length })
    const newest = newestDate(chunk)
    indexEntries.push(
      newest === undefined
        ? { loc: new URL(path, options.baseUrl).toString() }
        : { loc: new URL(path, options.baseUrl).toString(), lastmod: newest },
    )
  }
  if (files.length === 1 && !options.alwaysIndex) return { files }
  return { files, index: buildSitemapIndex(indexEntries) }
}

function newestDate(entries: readonly SitemapEntry[]): string | undefined {
  let best: string | undefined
  let bestMs = Number.NEGATIVE_INFINITY
  for (const e of entries) {
    if (e.lastmod === undefined) continue
    const d = normalizeDate(e.lastmod)
    if (d === undefined) continue
    const ms = Date.parse(d)
    if (ms > bestMs) {
      bestMs = ms
      best = d
    }
  }
  return best
}

// ---------------------------------------------------------------------------
// Freshness
// ---------------------------------------------------------------------------

export interface LastmodInput {
  readonly published?: DateInput
  readonly modified?: DateInput
  /**
   * A lower bound from another source (for example the last commit touching
   * the page). It can raise `lastmod` but never lower it.
   */
  readonly floor?: DateInput
}

/**
 * The honest `lastmod` for authored content: the latest of published, modified
 * and floor, where a modified date earlier than published is clamped up to
 * published. Invalid or impossible dates (`2026-02-31`) are ignored. Returns
 * `undefined` when no valid date is supplied.
 */
export function resolveLastmod(input: LastmodInput): string | undefined {
  const candidates = [input.published, input.modified, input.floor]
    .map((d) => (d === undefined ? undefined : normalizeDate(d)))
    .filter((d): d is string => d !== undefined)
  let best: string | undefined
  for (const d of candidates) if (best === undefined || Date.parse(d) > Date.parse(best)) best = d
  return best
}

export interface FreshnessRecord {
  /** Content fingerprint, e.g. a SHA-256 of the rendered main content. */
  readonly hash: string
  readonly lastmod: string
}

export type FreshnessManifest = Readonly<Record<string, FreshnessRecord>>

/**
 * Carry `lastmod` forward from a previous manifest: a URL keeps its old date
 * while its content hash is unchanged, gets `now` when the hash changes or the
 * URL is new, and is dropped when it disappears. This stops deploys, rebuilds
 * or layout tweaks from bumping every `lastmod` (which teaches crawlers to
 * ignore the field).
 *
 * Compute hashes with `sha256` / `contentHash` from `@bib/shared/hashing`.
 */
export function carryForwardLastmod(
  previous: FreshnessManifest,
  currentHashes: Readonly<Record<string, string>>,
  now: DateInput,
): {
  readonly manifest: FreshnessManifest
  readonly changed: readonly string[]
  readonly removed: readonly string[]
} {
  const stamp = normalizeDate(now)
  if (stamp === undefined) throw new RangeError(`now: invalid date ${String(now)}`)
  const manifest: Record<string, FreshnessRecord> = {}
  const changed: string[] = []
  for (const [url, hash] of Object.entries(currentHashes)) {
    const prior = previous[url]
    if (prior !== undefined && prior.hash === hash) {
      manifest[url] = prior
    } else {
      manifest[url] = { hash, lastmod: stamp }
      changed.push(url)
    }
  }
  const removed = Object.keys(previous).filter((url) => !(url in currentHashes))
  return { manifest, changed, removed }
}
