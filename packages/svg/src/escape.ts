/**
 * SVG-specific output helpers: element/attribute name checks and compact
 * number formatting. Text and attribute escaping come from `@bib/shared/xml`
 * (`escapeXml`, `escapeXmlAttr`).
 */

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
