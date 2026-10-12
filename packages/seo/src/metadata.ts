/**
 * Framework-agnostic page metadata: title templates, description length
 * checks, canonical URLs, Open Graph, Twitter cards, hreflang alternates and
 * robots directives. {@link buildPageMetadata} returns a plain object (map it
 * onto your framework's metadata API) plus non-fatal `warnings`;
 * {@link renderMetaTags} turns it into HTML `<head>` tags.
 */

import { escapeHtml } from "@bib/shared/strings"
import { absolutize, compact, type DateInput, isAbsoluteHttpUrl, requireDate } from "./internal.ts"

/** Length guidance in characters. Search engines truncate by pixel width, so these are heuristics. */
export const TITLE_LENGTH = { min: 10, max: 60 } as const
export const DESCRIPTION_LENGTH = { min: 50, max: 160 } as const

export type LengthVerdict = "missing" | "too-short" | "ok" | "too-long"

/** Classify a string against a `{ min, max }` character range (after trimming). */
export function checkLength(
  text: string | undefined,
  range: { readonly min: number; readonly max: number },
): LengthVerdict {
  const length = text?.trim().length ?? 0
  if (length === 0) return "missing"
  if (length < range.min) return "too-short"
  if (length > range.max) return "too-long"
  return "ok"
}

/**
 * Apply a title template. `%s` is replaced with the page title. When the page
 * title already equals the site name, or no template is given, the title is
 * returned as is.
 *
 * @example
 * ```ts
 * applyTitleTemplate("Pricing", "%s | Example") // "Pricing | Example"
 * ```
 */
export function applyTitleTemplate(title: string, template?: string, siteName?: string): string {
  const clean = title.trim()
  if (template === undefined || !template.includes("%s")) return clean
  if (siteName !== undefined && clean === siteName.trim()) return clean
  return template.replace("%s", clean)
}

export interface AlternateInput {
  /** BCP 47 tag such as `en`, `en-GB`, `pt-BR`, or `x-default`. */
  readonly hreflang: string
  readonly href: string
}

export type TwitterCard = "summary" | "summary_large_image" | "app" | "player"

export interface OgImageInput {
  readonly url: string
  readonly width?: number
  readonly height?: number
  readonly alt?: string
  readonly type?: string
}

export interface RobotsDirectives {
  readonly index?: boolean
  readonly follow?: boolean
  readonly noarchive?: boolean
  readonly nosnippet?: boolean
  /** `-1` = no limit. */
  readonly maxSnippet?: number
  readonly maxImagePreview?: "none" | "standard" | "large"
  readonly maxVideoPreview?: number
}

export interface PageMetadataInput {
  readonly title: string
  readonly description?: string
  /** Path or absolute URL of the canonical page. Resolved against `siteUrl`. */
  readonly path?: string
  readonly siteUrl?: string
  readonly siteName?: string
  /** e.g. `"%s | Example"`. */
  readonly titleTemplate?: string
  readonly locale?: string
  readonly type?: "website" | "article" | "product" | "profile"
  readonly images?: readonly (string | OgImageInput)[]
  readonly alternates?: readonly AlternateInput[]
  readonly twitter?: {
    readonly card?: TwitterCard
    /** `@handle` of the site. */
    readonly site?: string
    readonly creator?: string
  }
  readonly robots?: RobotsDirectives
  readonly article?: {
    readonly publishedTime?: DateInput
    readonly modifiedTime?: DateInput
    readonly authors?: readonly string[]
    readonly section?: string
    readonly tags?: readonly string[]
  }
}

export interface PageMetadata {
  readonly title: string
  readonly description?: string
  readonly canonical?: string
  readonly robots?: string
  readonly alternates: readonly AlternateInput[]
  readonly openGraph: Readonly<Record<string, string | readonly OgImageInput[] | readonly string[]>>
  readonly twitter: Readonly<Record<string, string>>
  /** Non-fatal problems: length guidance, relative URLs that could not be resolved, hreflang issues. */
  readonly warnings: readonly string[]
}

const HREFLANG = /^(x-default|[a-z]{2,3}(-[a-z]{4})?(-([a-z]{2}|\d{3}))?)$/i

/** True for `x-default` or a language tag of the form `ll`, `ll-RR`, `ll-Scrp-RR` (case-insensitive, as BCP 47 is). */
export function isValidHreflang(tag: string): boolean {
  return HREFLANG.test(tag)
}

/** Serialize robots directives to the `content` of `<meta name="robots">`. */
export function robotsContent(d: RobotsDirectives): string {
  const parts = [
    d.index === false ? "noindex" : "index",
    d.follow === false ? "nofollow" : "follow",
  ]
  if (d.noarchive) parts.push("noarchive")
  if (d.nosnippet) parts.push("nosnippet")
  if (d.maxSnippet !== undefined) parts.push(`max-snippet:${d.maxSnippet}`)
  if (d.maxImagePreview !== undefined) parts.push(`max-image-preview:${d.maxImagePreview}`)
  if (d.maxVideoPreview !== undefined) parts.push(`max-video-preview:${d.maxVideoPreview}`)
  return parts.join(", ")
}

/** Build page metadata. Throws only on structurally invalid input (an empty title). */
export function buildPageMetadata(input: PageMetadataInput): PageMetadata {
  const warnings: string[] = []
  if (input.title.trim() === "") throw new RangeError("title must not be empty")
  const title = applyTitleTemplate(input.title, input.titleTemplate, input.siteName)
  const titleVerdict = checkLength(title, TITLE_LENGTH)
  if (titleVerdict !== "ok")
    warnings.push(
      `title is ${titleVerdict} (${title.length} chars; aim for ${TITLE_LENGTH.min}-${TITLE_LENGTH.max})`,
    )
  const description = input.description?.trim()
  const descVerdict = checkLength(description, DESCRIPTION_LENGTH)
  if (descVerdict !== "ok") {
    warnings.push(
      `description is ${descVerdict} (${description?.length ?? 0} chars; aim for ${DESCRIPTION_LENGTH.min}-${DESCRIPTION_LENGTH.max})`,
    )
  }

  const resolve = (value: string, field: string): string | undefined => {
    const resolved = absolutize(value, input.siteUrl)
    if (!isAbsoluteHttpUrl(resolved)) {
      warnings.push(`${field} "${value}" is not absolute and no siteUrl was given`)
      return undefined
    }
    return resolved
  }

  const canonical = input.path === undefined ? undefined : resolve(input.path, "canonical")
  if (canonical !== undefined && new URL(canonical).hash)
    warnings.push("canonical should not contain a #fragment")

  const alternates: AlternateInput[] = []
  const seen = new Set<string>()
  for (const alt of input.alternates ?? []) {
    if (!isValidHreflang(alt.hreflang)) {
      warnings.push(`invalid hreflang "${alt.hreflang}"`)
      continue
    }
    const key = alt.hreflang.toLowerCase()
    if (seen.has(key)) {
      warnings.push(`duplicate hreflang "${alt.hreflang}"`)
      continue
    }
    const href = resolve(alt.href, `hreflang ${alt.hreflang}`)
    if (href === undefined) continue
    seen.add(key)
    alternates.push({ hreflang: alt.hreflang, href })
  }
  if (alternates.length > 0) {
    if (canonical !== undefined && !alternates.some((a) => a.href === canonical)) {
      warnings.push("hreflang alternates should include the canonical page itself (self-reference)")
    }
    if (!seen.has("x-default")) warnings.push("hreflang alternates have no x-default")
  }

  const ogImages: OgImageInput[] = []
  for (const img of input.images ?? []) {
    const spec = typeof img === "string" ? { url: img } : img
    const url = resolve(spec.url, "og:image")
    if (url !== undefined) ogImages.push({ ...spec, url })
  }
  if (ogImages.length === 0) warnings.push("no og:image; link previews will have no image")
  else if (ogImages.some((i) => i.alt === undefined)) warnings.push("og:image has no alt text")

  const ogType = input.type ?? (input.article ? "article" : "website")
  const openGraph = compact({
    "og:title": title,
    "og:description": description,
    "og:url": canonical,
    "og:site_name": input.siteName,
    "og:locale": input.locale?.replace("-", "_"),
    "og:type": ogType,
    "og:image": ogImages,
    "article:published_time":
      input.article?.publishedTime === undefined
        ? undefined
        : requireDate(input.article.publishedTime, "publishedTime"),
    "article:modified_time":
      input.article?.modifiedTime === undefined
        ? undefined
        : requireDate(input.article.modifiedTime, "modifiedTime"),
    "article:author": input.article?.authors,
    "article:section": input.article?.section,
    "article:tag": input.article?.tags,
  }) as Record<string, string | readonly OgImageInput[] | readonly string[]>

  const card = input.twitter?.card ?? (ogImages.length > 0 ? "summary_large_image" : "summary")
  for (const handle of [input.twitter?.site, input.twitter?.creator]) {
    if (handle !== undefined && !/^@\w{1,15}$/.test(handle))
      warnings.push(`twitter handle "${handle}" should look like @name`)
  }
  const twitter = compact({
    "twitter:card": card,
    "twitter:title": title,
    "twitter:description": description,
    "twitter:image": ogImages[0]?.url,
    "twitter:image:alt": ogImages[0]?.alt,
    "twitter:site": input.twitter?.site,
    "twitter:creator": input.twitter?.creator,
  }) as Record<string, string>

  return compact(
    {
      title,
      description,
      canonical,
      robots: input.robots === undefined ? undefined : robotsContent(input.robots),
      alternates,
      openGraph,
      twitter,
      warnings,
    },
    false,
  ) as unknown as PageMetadata
}

const attr = (text: string): string => escapeHtml(text)

/** Render {@link PageMetadata} as HTML `<head>` tags, one per line. All values are escaped. */
export function renderMetaTags(meta: PageMetadata): string {
  const lines: string[] = [`<title>${escapeHtml(meta.title)}</title>`]
  if (meta.description !== undefined)
    lines.push(`<meta name="description" content="${attr(meta.description)}">`)
  if (meta.robots !== undefined) lines.push(`<meta name="robots" content="${attr(meta.robots)}">`)
  if (meta.canonical !== undefined)
    lines.push(`<link rel="canonical" href="${attr(meta.canonical)}">`)
  for (const alt of meta.alternates) {
    lines.push(`<link rel="alternate" hreflang="${attr(alt.hreflang)}" href="${attr(alt.href)}">`)
  }
  for (const [key, value] of Object.entries(meta.openGraph)) {
    if (key === "og:image") {
      for (const img of value as readonly OgImageInput[]) {
        lines.push(`<meta property="og:image" content="${attr(img.url)}">`)
        if (img.width !== undefined)
          lines.push(`<meta property="og:image:width" content="${img.width}">`)
        if (img.height !== undefined)
          lines.push(`<meta property="og:image:height" content="${img.height}">`)
        if (img.type !== undefined)
          lines.push(`<meta property="og:image:type" content="${attr(img.type)}">`)
        if (img.alt !== undefined)
          lines.push(`<meta property="og:image:alt" content="${attr(img.alt)}">`)
      }
    } else if (Array.isArray(value)) {
      for (const v of value as readonly string[])
        lines.push(`<meta property="${key}" content="${attr(v)}">`)
    } else {
      lines.push(`<meta property="${key}" content="${attr(value as string)}">`)
    }
  }
  for (const [key, value] of Object.entries(meta.twitter)) {
    lines.push(`<meta name="${key}" content="${attr(value)}">`)
  }
  return lines.join("\n")
}
