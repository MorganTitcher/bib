/**
 * String utilities: slugs, truncation, case conversion, HTML escaping, and
 * simple English pluralization. All functions are pure and Unicode-aware where
 * it matters (truncation never splits a surrogate pair or combining sequence).
 *
 * @example
 * ```ts
 * import { slugify, truncateAtWord, kebabCase, pluralize } from "@bib/shared/strings"
 *
 * slugify("Café Déjà Vu — Q3 Plan!")           // "cafe-deja-vu-q3-plan"
 * truncateAtWord("The quick brown fox jumps", 15) // "The quick…"
 * kebabCase("parseHTTPResponse")                // "parse-http-response"
 * pluralize("category", 2)                      // "categories"
 * ```
 */

/** Collapse runs of whitespace to one space and trim the ends. */
export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/gu, " ").trim()
}

/**
 * URL-safe lowercase slug: strips diacritics, replaces anything that is not a
 * letter or digit with `-`, collapses repeats, and trims leading/trailing `-`.
 * Non-Latin letters (e.g. CJK) are kept rather than discarded.
 */
export function slugify(text: string, options: { readonly maxLength?: number } = {}): string {
  const slug = text
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
  const max = options.maxLength
  if (max === undefined || slug.length <= max) return slug
  return slug.slice(0, max).replace(/-+$/, "")
}

const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" })

function graphemes(text: string): string[] {
  return Array.from(segmenter.segment(text), (s) => s.segment)
}

/**
 * Cut `text` to at most `maxLength` graphemes, including the `ellipsis`.
 * Counts user-perceived characters, so emoji and accented letters are never
 * split.
 *
 * @example
 * ```ts
 * truncate("hello world", 8) // "hello w…"
 * ```
 */
export function truncate(text: string, maxLength: number, ellipsis = "…"): string {
  const chars = graphemes(text)
  if (chars.length <= maxLength) return text
  const room = maxLength - graphemes(ellipsis).length
  if (room <= 0) return graphemes(ellipsis).slice(0, maxLength).join("")
  return chars.slice(0, room).join("") + ellipsis
}

/**
 * Like {@link truncate} but backs up to the last whole word, so prose never ends
 * mid-word. Falls back to a hard cut if the first word alone is too long.
 */
export function truncateAtWord(text: string, maxLength: number, ellipsis = "…"): string {
  const chars = graphemes(text)
  if (chars.length <= maxLength) return text
  const room = maxLength - graphemes(ellipsis).length
  if (room <= 0) return truncate(text, maxLength, ellipsis)
  const head = chars.slice(0, room).join("")
  const nextChar = chars[room] ?? ""
  if (/\s/u.test(nextChar)) return head.trimEnd() + ellipsis
  const lastSpace = head.search(/\s\S*$/u)
  if (lastSpace <= 0) return head + ellipsis
  return head.slice(0, lastSpace).trimEnd() + ellipsis
}

/** Split an identifier or phrase into lowercase words, handling camelCase and acronyms. */
export function splitWords(text: string): string[] {
  return (
    text
      .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, "$1 $2")
      .replace(/(\p{Lu}+)(\p{Lu}\p{Ll})/gu, "$1 $2")
      .match(/[\p{L}\p{N}]+/gu) ?? []
  ).map((w) => w.toLowerCase())
}

/** `"hello world"` → `"helloWorld"`. */
export function camelCase(text: string): string {
  return splitWords(text)
    .map((w, i) => (i === 0 ? w : upperFirst(w)))
    .join("")
}

/** `"hello world"` → `"HelloWorld"`. */
export function pascalCase(text: string): string {
  return splitWords(text).map(upperFirst).join("")
}

/** `"helloWorld"` → `"hello_world"`. */
export function snakeCase(text: string): string {
  return splitWords(text).join("_")
}

/** `"helloWorld"` → `"hello-world"`. */
export function kebabCase(text: string): string {
  return splitWords(text).join("-")
}

/** Upper-case the first character. */
export function upperFirst(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

const SMALL_WORDS = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "but",
  "by",
  "for",
  "in",
  "nor",
  "of",
  "on",
  "or",
  "per",
  "the",
  "to",
  "vs",
  "via",
])

/**
 * Title Case with common English small words lowercased unless first or last.
 * Words already written in ALL CAPS (acronyms like "API") are preserved.
 *
 * @example
 * ```ts
 * titleCase("the state of the API in 2026") // "The State of the API in 2026"
 * ```
 */
export function titleCase(text: string): string {
  const words = normalizeWhitespace(text).split(" ")
  return words
    .map((word, i) => {
      if (word.length > 1 && word === word.toUpperCase() && /\p{Lu}/u.test(word)) return word
      const lower = word.toLowerCase()
      if (i !== 0 && i !== words.length - 1 && SMALL_WORDS.has(lower)) return lower
      return upperFirst(lower)
    })
    .join(" ")
}

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
}

/** Escape `& < > " '` for safe insertion into HTML text or a quoted attribute. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] ?? ch)
}

const IRREGULAR: Readonly<Record<string, string>> = {
  person: "people",
  child: "children",
  man: "men",
  woman: "women",
  mouse: "mice",
  goose: "geese",
  foot: "feet",
  tooth: "teeth",
  datum: "data",
  criterion: "criteria",
  analysis: "analyses",
}

/**
 * English plural of `word` when `count !== 1` (pass an explicit `plural` for
 * anything the rules get wrong). Preserves a leading capital.
 *
 * @example
 * ```ts
 * pluralize("box", 3)   // "boxes"
 * pluralize("day", 2)   // "days"
 * pluralize("person", 0) // "people"
 * pluralize("cactus", 2, "cacti") // "cacti"
 * ```
 */
export function pluralize(word: string, count: number, plural?: string): string {
  if (count === 1 || count === -1) return word
  if (plural !== undefined) return plural
  const lower = word.toLowerCase()
  let result: string
  const irregular = IRREGULAR[lower]
  if (irregular !== undefined) result = irregular
  else if (/[^aeiou]y$/.test(lower)) result = `${lower.slice(0, -1)}ies`
  else if (/(s|x|z|ch|sh)$/.test(lower)) result = `${lower}es`
  else result = `${lower}s`
  return word.charAt(0) === word.charAt(0).toUpperCase() &&
    word.charAt(0) !== word.charAt(0).toLowerCase()
    ? upperFirst(result)
    : result
}
