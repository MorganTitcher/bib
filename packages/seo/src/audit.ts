/**
 * Page and site SEO lint. {@link extractPageSnapshot} pulls the relevant facts
 * out of rendered HTML; {@link auditPage} and {@link auditSite} report issues
 * with a stable `code`, a `severity` and a message.
 *
 * The extractor is regex-based: good for build output and server-rendered
 * pages you control, not a general HTML parser. Content injected by client
 * JavaScript is invisible to it (and often to crawlers too).
 */

import { checkLength, DESCRIPTION_LENGTH, isValidHreflang, TITLE_LENGTH } from "./metadata.ts"

export type Severity = "error" | "warning" | "info"

export interface AuditIssue {
  readonly code: string
  readonly severity: Severity
  readonly message: string
  /** Page URL(s) the issue applies to. */
  readonly urls: readonly string[]
}

export interface PageSnapshot {
  readonly url: string
  readonly title?: string
  readonly description?: string
  readonly canonical?: string
  /** Content of `<meta name="robots">`, lower-cased. */
  readonly robots?: string
  readonly lang?: string
  readonly h1: readonly string[]
  readonly images: readonly { readonly src: string; readonly alt?: string }[]
  readonly alternates: readonly { readonly hreflang: string; readonly href: string }[]
  /** Raw bodies of `<script type="application/ld+json">` blocks. */
  readonly jsonLd: readonly string[]
  /** `og:*` meta properties (first value wins). */
  readonly openGraph: Readonly<Record<string, string>>
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  "#39": "'",
  nbsp: " ",
}

function decode(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+|#39);/gi, (m, name: string) => ENTITIES[name.toLowerCase()] ?? m)
}

function stripTags(html: string): string {
  return decode(html.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim()
}

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of tag.matchAll(
    /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g,
  )) {
    const name = (m[1] ?? "").toLowerCase()
    if (!(name in out)) out[name] = decode(m[3] ?? m[4] ?? m[5] ?? "")
  }
  return out
}

function tags(html: string, name: string): Record<string, string>[] {
  return [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, "gi"))].map((m) => attrs(m[0]))
}

/** Extract a {@link PageSnapshot} from an HTML document. HTML comments are ignored. */
export function extractPageSnapshot(html: string, url: string): PageSnapshot {
  const doc = html.replace(/<!--[\s\S]*?-->/g, "")
  const head = doc.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1] ?? doc
  const title = head.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]
  const metas = tags(head, "meta")
  const links = tags(head, "link")
  const metaNamed = (name: string) => metas.find((m) => m.name?.toLowerCase() === name)?.content
  const openGraph: Record<string, string> = {}
  for (const m of metas) {
    const prop = m.property?.toLowerCase()
    if (prop?.startsWith("og:") && m.content !== undefined && !(prop in openGraph))
      openGraph[prop] = m.content
  }
  const rels = (rel: string) =>
    links.filter((l) => (l.rel ?? "").toLowerCase().split(/\s+/).includes(rel))
  const canonical = rels("canonical")[0]?.href
  const alternates = rels("alternate")
    .filter((l) => l.hreflang !== undefined && l.href !== undefined)
    .map((l) => ({ hreflang: l.hreflang as string, href: l.href as string }))
  const htmlTag = doc.match(/<html\b[^>]*>/i)?.[0]
  const lang = htmlTag === undefined ? undefined : attrs(htmlTag).lang
  const h1 = [...doc.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) => stripTags(m[1] ?? ""))
  const images = tags(doc, "img").map((a) =>
    a.alt === undefined ? { src: a.src ?? "" } : { src: a.src ?? "", alt: a.alt },
  )
  const jsonLd = [...doc.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter((m) => (attrs(m[1] ?? "").type ?? "").toLowerCase() === "application/ld+json")
    .map((m) => (m[2] ?? "").trim())
  const description = metaNamed("description")
  const robots = metaNamed("robots")?.toLowerCase()
  const snapshot: PageSnapshot = {
    url,
    h1,
    images,
    alternates,
    jsonLd,
    openGraph,
    ...(title === undefined ? {} : { title: stripTags(title) }),
    ...(description === undefined ? {} : { description: description.trim() }),
    ...(canonical === undefined ? {} : { canonical }),
    ...(robots === undefined ? {} : { robots }),
    ...(lang === undefined ? {} : { lang }),
  }
  return snapshot
}

function issue(code: string, severity: Severity, message: string, url: string): AuditIssue {
  return { code, severity, message, urls: [url] }
}

/** Lint one page. Issues are ordered errors first, then warnings, then info. */
export function auditPage(page: PageSnapshot): AuditIssue[] {
  const out: AuditIssue[] = []
  const u = page.url
  const t = checkLength(page.title, TITLE_LENGTH)
  if (t === "missing") out.push(issue("title-missing", "error", "page has no <title>", u))
  else if (t !== "ok")
    out.push(issue(`title-${t}`, "warning", `title is ${t} (${page.title?.length} chars)`, u))
  const d = checkLength(page.description, DESCRIPTION_LENGTH)
  if (d === "missing")
    out.push(issue("description-missing", "warning", "page has no meta description", u))
  else if (d !== "ok")
    out.push(
      issue(
        `description-${d}`,
        "info",
        `meta description is ${d} (${page.description?.length} chars)`,
        u,
      ),
    )

  if (page.canonical === undefined)
    out.push(issue("canonical-missing", "warning", "page has no rel=canonical", u))
  else {
    let canon: URL | undefined
    try {
      canon = new URL(page.canonical)
    } catch {
      out.push(
        issue(
          "canonical-relative",
          "error",
          `canonical "${page.canonical}" is not an absolute URL`,
          u,
        ),
      )
    }
    if (canon !== undefined) {
      if (canon.hash)
        out.push(issue("canonical-fragment", "warning", "canonical contains a #fragment", u))
      if (canon.protocol === "http:")
        out.push(issue("canonical-http", "warning", "canonical uses http, not https", u))
    }
  }

  const noindex =
    page.robots?.split(/\s*,\s*/).some((v) => v === "noindex" || v === "none") ?? false
  if (noindex)
    out.push(issue("noindex", "info", "page is noindex; it will not appear in search results", u))

  if (page.lang === undefined || page.lang.trim() === "")
    out.push(issue("lang-missing", "warning", "<html> has no lang attribute", u))
  if (page.h1.length === 0) out.push(issue("h1-missing", "warning", "page has no <h1>", u))
  else if (page.h1.length > 1)
    out.push(issue("h1-multiple", "info", `page has ${page.h1.length} <h1> elements`, u))
  if (page.h1.some((h) => h === "")) out.push(issue("h1-empty", "warning", "an <h1> is empty", u))

  const noAlt = page.images.filter((i) => i.alt === undefined)
  if (noAlt.length > 0)
    out.push(
      issue("img-alt-missing", "warning", `${noAlt.length} image(s) have no alt attribute`, u),
    )

  const seenLang = new Set<string>()
  for (const alt of page.alternates) {
    if (!isValidHreflang(alt.hreflang))
      out.push(issue("hreflang-invalid", "error", `invalid hreflang "${alt.hreflang}"`, u))
    const key = alt.hreflang.toLowerCase()
    if (seenLang.has(key))
      out.push(issue("hreflang-duplicate", "error", `duplicate hreflang "${alt.hreflang}"`, u))
    seenLang.add(key)
  }
  if (page.alternates.length > 0) {
    const self = page.canonical ?? page.url
    if (!page.alternates.some((a) => a.href === self)) {
      out.push(issue("hreflang-no-self", "warning", "hreflang set does not reference this page", u))
    }
    if (!seenLang.has("x-default"))
      out.push(issue("hreflang-no-x-default", "info", "hreflang set has no x-default", u))
  }

  for (const [i, raw] of page.jsonLd.entries()) {
    try {
      const parsed: unknown = JSON.parse(raw)
      const nodes = Array.isArray(parsed) ? parsed : [parsed]
      for (const node of nodes) {
        if (typeof node !== "object" || node === null || !("@type" in node || "@graph" in node)) {
          out.push(
            issue("jsonld-no-type", "warning", `JSON-LD block ${i + 1} has no @type or @graph`, u),
          )
        }
      }
    } catch {
      out.push(issue("jsonld-invalid", "error", `JSON-LD block ${i + 1} is not valid JSON`, u))
    }
  }

  for (const prop of ["og:title", "og:image"]) {
    if (page.openGraph[prop] === undefined)
      out.push(issue(`${prop.replace(":", "-")}-missing`, "info", `no ${prop} meta tag`, u))
  }

  const rank: Record<Severity, number> = { error: 0, warning: 1, info: 2 }
  return out.sort((a, b) => rank[a.severity] - rank[b.severity])
}

/**
 * Lint a set of pages: every per-page issue plus cross-page checks
 * (duplicate titles and descriptions among indexable pages, hreflang return
 * links, canonicals pointing at pages not in the set are left alone).
 */
export function auditSite(pages: readonly PageSnapshot[]): AuditIssue[] {
  const out: AuditIssue[] = pages.flatMap((p) => auditPage(p))
  const indexable = pages.filter(
    (p) => !(p.robots?.split(/\s*,\s*/).some((v) => v === "noindex" || v === "none") ?? false),
  )
  for (const [field, code] of [
    ["title", "title-duplicate"],
    ["description", "description-duplicate"],
  ] as const) {
    const groups = new Map<string, string[]>()
    for (const p of indexable) {
      const value = p[field]?.trim().toLowerCase()
      if (!value) continue
      groups.set(value, [...(groups.get(value) ?? []), p.url])
    }
    for (const urls of groups.values()) {
      if (urls.length > 1)
        out.push({
          code,
          severity: "warning",
          message: `${urls.length} pages share the same ${field}`,
          urls,
        })
    }
  }
  const byUrl = new Map<string, PageSnapshot>()
  for (const p of pages) byUrl.set(p.canonical ?? p.url, p)
  for (const p of pages) {
    const self = p.canonical ?? p.url
    for (const alt of p.alternates) {
      if (alt.href === self) continue
      const target = byUrl.get(alt.href)
      if (target === undefined) continue
      if (!target.alternates.some((a) => a.href === self)) {
        out.push({
          code: "hreflang-no-return",
          severity: "error",
          message: `${alt.href} does not link back to ${self} (hreflang must be reciprocal)`,
          urls: [self, alt.href],
        })
      }
    }
  }
  return out
}
