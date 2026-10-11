/**
 * XML text escaping shared by the sitemap and feed builders.
 *
 * XML 1.0 forbids most C0 control characters outright (they cannot be escaped,
 * not even as numeric references), and a lone UTF-16 surrogate is not a valid
 * character either. Both are removed before escaping, so a stray `\u0007`
 * pasted into a title cannot make a whole sitemap or feed unparseable.
 */

/** XML 1.0 `Char`: tab, LF, CR, U+0020\u2013U+D7FF, U+E000\u2013U+FFFD and U+10000\u2013U+10FFFF. */
function isXmlChar(cp: number): boolean {
  if (cp === 0x9 || cp === 0xa || cp === 0xd) return true
  if (cp >= 0x20 && cp <= 0xd7ff) return true
  if (cp >= 0xe000 && cp <= 0xfffd) return true
  return cp >= 0x10000 && cp <= 0x10ffff
}

/**
 * Remove characters XML 1.0 cannot represent at all. Iterating by code point
 * keeps surrogate pairs together; a lone surrogate comes out as its own code
 * point in the D800\u2013DFFF range and is dropped.
 */
export function stripInvalidXmlChars(text: string): string {
  let out = ""
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0
    if (isXmlChar(cp)) out += ch
  }
  return out
}

const XML_ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
}

/**
 * Escape text for an XML element body or a quoted attribute: strips invalid
 * characters, then escapes `& < > " '`.
 *
 * @example
 * ```ts
 * escapeXml("Q&A <draft>") // "Q&amp;A &lt;draft&gt;"
 * ```
 */
export function escapeXml(text: string): string {
  return stripInvalidXmlChars(text).replace(/[&<>"']/g, (ch) => XML_ESCAPES[ch] ?? ch)
}

/**
 * Wrap text in a CDATA section, splitting any `]]>` so it cannot close the
 * section early. Invalid XML characters are stripped.
 */
export function cdata(text: string): string {
  return `<![CDATA[${stripInvalidXmlChars(text).replaceAll("]]>", "]]]]><![CDATA[>")}]]>`
}
