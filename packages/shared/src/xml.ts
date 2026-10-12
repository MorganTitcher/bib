/**
 * XML 1.0 text safety: character validity, escaping and CDATA wrapping.
 *
 * XML 1.0 forbids most C0 control characters outright (they cannot be escaped,
 * not even as numeric references), and a lone UTF-16 surrogate is not a valid
 * character either. Every writer here removes both before escaping, so a stray
 * `\u0007` pasted into a title cannot make a whole document unparseable.
 *
 * Escaping builds on {@link escapeHtml}, so `'` is written as `&#39;` — valid in
 * both XML and HTML, unlike `&apos;` which HTML 4 lacks.
 *
 * @example
 * ```ts
 * import { cdata, escapeXml, escapeXmlAttr } from "@bib/shared/xml"
 *
 * escapeXml("Q&A <b> \u0007")   // "Q&amp;A &lt;b&gt; "
 * escapeXmlAttr("a\nb")         // "a&#10;b"
 * cdata("a ]]> b")              // "<![CDATA[a ]]]]><![CDATA[> b]]>"
 * ```
 */
import { escapeHtml } from "./strings.ts"

/** XML 1.0 `Char`: tab, LF, CR, U+0020–U+D7FF, U+E000–U+FFFD and U+10000–U+10FFFF. */
export function isXmlChar(codePoint: number): boolean {
  if (codePoint === 0x9 || codePoint === 0xa || codePoint === 0xd) return true
  if (codePoint >= 0x20 && codePoint <= 0xd7ff) return true
  if (codePoint >= 0xe000 && codePoint <= 0xfffd) return true
  return codePoint >= 0x10000 && codePoint <= 0x10ffff
}

/**
 * Remove characters XML 1.0 cannot represent at all. Iterating by code point
 * keeps surrogate pairs together; a lone surrogate comes out as its own code
 * point in the D800–DFFF range and is dropped.
 */
export function stripInvalidXmlChars(text: string): string {
  let out = ""
  for (const ch of text) {
    if (isXmlChar(ch.codePointAt(0) ?? 0)) out += ch
  }
  return out
}

/**
 * Escape text for an XML element body: strips invalid characters, then escapes
 * `& < > " '`. Also safe inside a quoted attribute, but attribute-value
 * normalization will turn literal tabs and newlines into spaces — use
 * {@link escapeXmlAttr} when those must survive.
 */
export function escapeXml(text: string): string {
  return escapeHtml(stripInvalidXmlChars(text))
}

const ATTR_WHITESPACE: Readonly<Record<string, string>> = {
  "\t": "&#9;",
  "\n": "&#10;",
  "\r": "&#13;",
}

/**
 * Escape text for a single- or double-quoted XML attribute value. Like
 * {@link escapeXml}, and additionally writes tab, LF and CR as character
 * references so attribute-value normalization preserves them.
 */
export function escapeXmlAttr(text: string): string {
  return escapeXml(text).replace(/[\t\n\r]/g, (ch) => ATTR_WHITESPACE[ch] ?? ch)
}

/**
 * Wrap text in a CDATA section, splitting any `]]>` so it cannot close the
 * section early. Invalid XML characters are stripped.
 */
export function cdata(text: string): string {
  return `<![CDATA[${stripInvalidXmlChars(text).replaceAll("]]>", "]]]]><![CDATA[>")}]]>`
}
