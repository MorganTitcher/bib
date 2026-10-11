/**
 * XML escaping for SVG text nodes and attribute values.
 *
 * Builds on `escapeHtml` from `@bib/shared/strings` (which handles `& < > " '`)
 * and adds the XML-specific parts: characters that are illegal anywhere in an
 * XML 1.0 document are removed, and whitespace inside attribute values is
 * written as character references so attribute-value normalization does not
 * silently turn a newline into a space.
 */
import { escapeHtml } from "@bib/shared/strings"

/**
 * Characters outside the XML 1.0 `Char` production: C0 controls other than
 * tab, newline and carriage return; U+FFFE and U+FFFF; and lone surrogates.
 */
const ILLEGAL_XML_CHARS =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the purpose
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g

/** Remove characters that cannot appear in an XML 1.0 document at all. */
export function stripIllegalXmlChars(text: string): string {
  return text.replace(ILLEGAL_XML_CHARS, "")
}

/** Escape a string for use as XML character data (between tags). */
export function escapeXmlText(text: string): string {
  return escapeHtml(stripIllegalXmlChars(text))
}

const ATTR_WHITESPACE: Readonly<Record<string, string>> = {
  "\t": "&#9;",
  "\n": "&#10;",
  "\r": "&#13;",
}

/**
 * Escape a string for use inside a double- or single-quoted XML attribute.
 * Tabs, newlines and carriage returns become character references.
 */
export function escapeXmlAttr(text: string): string {
  return escapeXmlText(text).replace(/[\t\n\r]/g, (ch) => ATTR_WHITESPACE[ch] ?? ch)
}

/** XML `Name` check for element and attribute names (ASCII subset plus `:`, `-`, `.`). */
const XML_NAME = /^[A-Za-z_:][A-Za-z0-9_:.-]*$/

/** True when `name` is a safe element or attribute name to emit verbatim. */
export function isXmlName(name: string): boolean {
  return XML_NAME.test(name)
}

/**
 * Format a number for SVG output: finite only, at most `precision` decimals,
 * trailing zeros removed, and `-0` written as `0`.
 *
 * @throws RangeError when `value` is `NaN` or infinite.
 */
export function formatNumber(value: number, precision = 3): string {
  if (!Number.isFinite(value)) throw new RangeError(`non-finite number: ${value}`)
  const fixed = value.toFixed(precision)
  const trimmed = fixed.includes(".") ? fixed.replace(/\.?0+$/, "") : fixed
  return trimmed === "-0" ? "0" : trimmed
}
