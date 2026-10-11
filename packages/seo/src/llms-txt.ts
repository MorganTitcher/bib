/**
 * llms.txt (https://llmstxt.org): a Markdown index that helps language models
 * find a site's most useful pages. The format is:
 *
 * 1. an H1 with the site or project name (required),
 * 2. a blockquote summary,
 * 3. optional free-form paragraphs,
 * 4. H2 sections, each a list of `- [title](url): notes` links,
 * 5. an `## Optional` section for links a model can skip when context is short.
 *
 * Link titles and notes are free text, so Markdown control characters in them
 * are escaped; a title containing `]` cannot break the link syntax.
 */

import { absolutize, isAbsoluteHttpUrl } from "./internal.ts"

export interface LlmsLink {
  readonly title: string
  /** Absolute URL, or a path resolved against `baseUrl`. */
  readonly url: string
  readonly notes?: string
}

export interface LlmsSection {
  readonly title: string
  readonly links: readonly LlmsLink[]
}

export interface LlmsTxtInput {
  readonly title: string
  readonly summary?: string
  /** Free-form Markdown paragraphs, written as-is (trusted). */
  readonly details?: readonly string[]
  readonly sections?: readonly LlmsSection[]
  /** Links for the `## Optional` section. */
  readonly optional?: readonly LlmsLink[]
  readonly baseUrl?: string
}

/** Escape Markdown inline control characters in untrusted link text. */
export function escapeMarkdownInline(text: string): string {
  return text
    .replace(/[\r\n]+/g, " ")
    .replace(/[\\`*_[\]<>|]/g, (ch) => `\\${ch}`)
    .trim()
}

function linkLine(link: LlmsLink, baseUrl: string | undefined): string {
  if (link.title.trim() === "") throw new RangeError("llms.txt link title must not be blank")
  const url = absolutize(link.url, baseUrl)
  if (!isAbsoluteHttpUrl(url))
    throw new RangeError(`llms.txt link "${link.title}" needs an absolute URL or a baseUrl`)
  // Parentheses and spaces in the URL would end the link target early.
  // encodeURIComponent leaves parentheses alone, so map them explicitly.
  const target = url.replace(/[ ()]/g, (ch) => (ch === " " ? "%20" : ch === "(" ? "%28" : "%29"))
  const notes = link.notes?.trim() ? `: ${escapeMarkdownInline(link.notes)}` : ""
  return `- [${escapeMarkdownInline(link.title)}](${target})${notes}`
}

/** Build an llms.txt body. Empty sections are omitted; a section named "Optional" is rejected (use `optional`). */
export function buildLlmsTxt(input: LlmsTxtInput): string {
  const title = input.title.replace(/[\r\n]+/g, " ").trim()
  if (title === "") throw new RangeError("llms.txt title must not be blank")
  const out: string[] = [`# ${title}`]
  if (input.summary?.trim()) {
    out.push(
      input.summary
        .trim()
        .split(/\r?\n/)
        .map((l) => `> ${l}`.trimEnd())
        .join("\n"),
    )
  }
  for (const p of input.details ?? []) if (p.trim()) out.push(p.trim())
  for (const section of input.sections ?? []) {
    if (section.title.trim().toLowerCase() === "optional") {
      throw new RangeError('use the `optional` field for the "Optional" section')
    }
    if (section.links.length === 0) continue
    out.push(
      `## ${section.title.trim()}\n\n${section.links.map((l) => linkLine(l, input.baseUrl)).join("\n")}`,
    )
  }
  if (input.optional?.length) {
    out.push(`## Optional\n\n${input.optional.map((l) => linkLine(l, input.baseUrl)).join("\n")}`)
  }
  return `${out.join("\n\n")}\n`
}
