/**
 * A tiny typed element builder that produces SVG markup strings.
 *
 * `h("rect", { width: 10 })` returns a {@link Markup} value. Strings and numbers
 * passed as children are escaped; `Markup` children are inserted verbatim, so
 * nesting `h()` calls never double-escapes and plain text can never inject tags.
 *
 * The builder is for markup you author. It refuses invalid names and `on*`
 * event-handler attributes, but it does not sanitize untrusted documents; use
 * `sanitizeSvg` from `@bib/svg/sanitize` for that.
 */
import { escapeXmlAttr, escapeXmlText, isXmlName } from "./escape.ts"

/** Markup that is already serialized and safe to insert verbatim. */
export class Markup {
  readonly value: string
  constructor(value: string) {
    this.value = value
  }
  toString(): string {
    return this.value
  }
}

/** An attribute value. `null`, `undefined` and `false` omit the attribute. */
export type AttrValue = string | number | null | undefined | false

/** Attributes keyed by their SVG name (`"stroke-width"`, `"xlink:href"`, ...). */
export type Attrs = Readonly<Record<string, AttrValue>>

/** A child: text (escaped), markup (verbatim), nested arrays, or nothing. */
export type Child = string | number | Markup | null | undefined | false | readonly Child[]

/** Wrap trusted, already-serialized markup so `h()` inserts it verbatim. */
export function raw(markup: string): Markup {
  return new Markup(markup)
}

/** True for a {@link Markup} value. */
export function isMarkup(value: unknown): value is Markup {
  return value instanceof Markup
}

function serializeAttrs(attrs: Attrs): string {
  let out = ""
  for (const [name, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue
    if (!isXmlName(name)) throw new TypeError(`invalid attribute name: ${JSON.stringify(name)}`)
    if (/^on/i.test(name)) throw new TypeError(`event handler attributes are not allowed: ${name}`)
    let text: string
    if (typeof value === "number") {
      if (!Number.isFinite(value)) throw new RangeError(`non-finite value for ${name}: ${value}`)
      text = String(value)
    } else {
      text = value
    }
    out += ` ${name}="${escapeXmlAttr(text)}"`
  }
  return out
}

function serializeChildren(children: readonly Child[]): string {
  let out = ""
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue
    if (child instanceof Markup) out += child.value
    else if (typeof child === "string") out += escapeXmlText(child)
    else if (typeof child === "number") out += escapeXmlText(String(child))
    else out += serializeChildren(child)
  }
  return out
}

/**
 * Build an element. Elements with no (non-empty) children are self-closed.
 *
 * @example
 * ```ts
 * h("g", { fill: "#111" }, h("rect", { width: 4, height: 4 }), h("text", {}, "a < b")).value
 * // '<g fill="#111"><rect width="4" height="4"/><text>a &lt; b</text></g>'
 * ```
 */
export function h(tag: string, attrs: Attrs = {}, ...children: Child[]): Markup {
  if (!isXmlName(tag)) throw new TypeError(`invalid element name: ${JSON.stringify(tag)}`)
  const open = `<${tag}${serializeAttrs(attrs)}`
  const inner = serializeChildren(children)
  return new Markup(inner === "" ? `${open}/>` : `${open}>${inner}</${tag}>`)
}

/** Concatenate children into one {@link Markup} without a wrapping element. */
export function fragment(...children: Child[]): Markup {
  return new Markup(serializeChildren(children))
}

/** The SVG namespace URI. */
export const SVG_NS = "http://www.w3.org/2000/svg"

/** `h("svg", ...)` with `xmlns` defaulted to the SVG namespace. */
export function svg(attrs: Attrs = {}, ...children: Child[]): Markup {
  return h("svg", { xmlns: SVG_NS, ...attrs }, ...children)
}
