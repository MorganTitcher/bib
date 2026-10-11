/**
 * A conservative SVG sanitizer: parse, filter against a default-deny
 * allowlist, check reference integrity, and re-serialize.
 *
 * The output is regenerated from a parsed tree, never patched with string
 * replacements, so anything the parser does not understand is either rejected
 * or dropped. What survives:
 *
 * - a fixed set of static drawing elements (no `script`, `style`,
 *   `foreignObject`, `a`, animation, `feImage`, or `image` unless opted in);
 * - a fixed set of presentation and geometry attributes (no `on*`, no
 *   `style`, no `xml:base`);
 * - `href` only as a local `#id` reference (or, for `<image>` with
 *   `allowImages`, a base64 PNG/JPEG/GIF/WebP `data:` URI; never SVG);
 * - `url(...)` in attribute values only as a local `url(#id)`, checked after
 *   CSS escapes and comments are decoded.
 *
 * Documents with a DOCTYPE or ENTITY declaration, an `xml-stylesheet`
 * processing instruction, malformed XML, excessive size or nesting, `<use>`
 * reference cycles, or runaway `<use>` expansion are rejected outright.
 */
import { escapeXmlAttr, escapeXmlText } from "./escape.ts"
import { parseXml, type XmlElement, type XmlNode } from "./xml.ts"

const SVG_NS = "http://www.w3.org/2000/svg"

/** Elements that survive sanitization. Anything else is removed with its subtree. */
export const ALLOWED_ELEMENTS: ReadonlySet<string> = new Set([
  "svg",
  "g",
  "defs",
  "title",
  "desc",
  "symbol",
  "use",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "text",
  "tspan",
  "textPath",
  "linearGradient",
  "radialGradient",
  "stop",
  "clipPath",
  "mask",
  "pattern",
  "marker",
  "filter",
  "feGaussianBlur",
  "feOffset",
  "feBlend",
  "feColorMatrix",
  "feComposite",
  "feFlood",
  "feMerge",
  "feMergeNode",
  "feMorphology",
  "feDropShadow",
])

/** Attributes that survive sanitization (on any allowed element). */
export const ALLOWED_ATTRIBUTES: ReadonlySet<string> = new Set([
  "id",
  "class",
  "transform",
  "fill",
  "fill-opacity",
  "fill-rule",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-opacity",
  "opacity",
  "clip-path",
  "clip-rule",
  "mask",
  "filter",
  "color",
  "display",
  "visibility",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "text-anchor",
  "dominant-baseline",
  "letter-spacing",
  "word-spacing",
  "text-decoration",
  "aria-label",
  "aria-labelledby",
  "aria-describedby",
  "aria-hidden",
  "role",
  "lang",
  "xml:lang",
  "xml:space",
  "vector-effect",
  "shape-rendering",
  "paint-order",
  "stop-color",
  "stop-opacity",
  "offset",
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "fx",
  "fy",
  "fr",
  "dx",
  "dy",
  "width",
  "height",
  "d",
  "points",
  "pathLength",
  "viewBox",
  "preserveAspectRatio",
  "version",
  "baseProfile",
  "gradientUnits",
  "gradientTransform",
  "spreadMethod",
  "patternUnits",
  "patternContentUnits",
  "patternTransform",
  "clipPathUnits",
  "maskUnits",
  "maskContentUnits",
  "markerWidth",
  "markerHeight",
  "markerUnits",
  "refX",
  "refY",
  "orient",
  "marker-start",
  "marker-mid",
  "marker-end",
  "href",
  "rotate",
  "textLength",
  "lengthAdjust",
  "startOffset",
  "filterUnits",
  "primitiveUnits",
  "in",
  "in2",
  "result",
  "stdDeviation",
  "mode",
  "operator",
  "k1",
  "k2",
  "k3",
  "k4",
  "type",
  "values",
  "flood-color",
  "flood-opacity",
  "radius",
  "color-interpolation-filters",
])

/** Attributes whose numbers must stay within `maxCoordinate`. */
const BOUNDED_ATTRIBUTES: ReadonlySet<string> = new Set([
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "fx",
  "fy",
  "fr",
  "dx",
  "dy",
  "width",
  "height",
  "viewBox",
  "stroke-width",
  "font-size",
  "stdDeviation",
  "radius",
])

/** Elements that keep their text content. */
const TEXT_CONTAINERS: ReadonlySet<string> = new Set(["text", "tspan", "textPath", "title", "desc"])

/** Elements that are meaningless without their `href` target; dropped when it is missing. */
const REQUIRES_HREF: ReadonlySet<string> = new Set(["use", "textPath", "image"])

/** Attributes holding space-separated id references. */
const IDREF_LIST_ATTRIBUTES: ReadonlySet<string> = new Set(["aria-labelledby", "aria-describedby"])

/** Identifier syntax accepted for `id` values and local references. */
export const SAFE_ID = /^[A-Za-z_][A-Za-z0-9_-]{0,127}$/

const SAFE_RASTER_DATA_URI = /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/

const NUMBER = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g

export type SanitizeFailureCode =
  | "too-large"
  | "declaration"
  | "stylesheet"
  | "malformed"
  | "too-deep"
  | "too-many-nodes"
  | "root"
  | "geometry-budget"
  | "use-cycle"
  | "use-expansion"
  | "residual-danger"

export type RemovalReason =
  | "not-allowed"
  | "event-handler"
  | "unsafe-url"
  | "unsafe-style"
  | "out-of-range"
  | "invalid-id"
  | "duplicate-id"
  | "dangling-reference"
  | "comment"
  | "processing-instruction"
  | "cdata"
  | "stray-text"

/** One thing the sanitizer removed, for logging or display. */
export interface Removal {
  readonly kind: "element" | "attribute" | "node"
  /** Element or attribute name (`#comment`, `#cdata`, `#text`, or the PI target for nodes). */
  readonly name: string
  /** The element the attribute was on, for attribute removals. */
  readonly element?: string
  readonly reason: RemovalReason
}

export type SanitizeResult =
  | { readonly ok: true; readonly svg: string; readonly removed: readonly Removal[] }
  | {
      readonly ok: false
      readonly svg: null
      readonly removed: readonly Removal[]
      readonly reason: SanitizeFailureCode
      readonly message: string
    }

export interface SanitizeOptions {
  /** Maximum UTF-8 input size in bytes (default 8 MiB). */
  readonly maxBytes?: number
  /** Maximum element nesting depth (default 100). */
  readonly maxDepth?: number
  /** Maximum number of parsed nodes (default 100 000). */
  readonly maxNodes?: number
  /** Maximum total length of all `d` and `points` values (default 4 MiB). */
  readonly maxGeometryBytes?: number
  /** Largest absolute number allowed in coordinate attributes (default 1e6). */
  readonly maxCoordinate?: number
  /** Maximum elements after expanding every `<use>` (default 1 000 000). */
  readonly maxRenderedElements?: number
  /** Keep `<image>` with base64 PNG/JPEG/GIF/WebP `data:` URIs (default false). */
  readonly allowImages?: boolean
}

interface SNode {
  readonly name: string
  readonly attrs: Map<string, string>
  children: (SNode | string)[]
  parent: SNode | null
}

/** UTF-8 encoded length of `text` without allocating. */
export function utf8ByteLength(text: string): number {
  let bytes = 0
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i)
    if (code < 0x80) bytes += 1
    else if (code < 0x800) bytes += 2
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4
        i += 1
      } else bytes += 3
    } else bytes += 3
  }
  return bytes
}

/** Decode CSS escapes (`\75`, `\u`) and drop CSS comments and NULs. */
export function decodeCssEscapes(value: string): string {
  return (
    value
      .replace(/\\([0-9A-Fa-f]{1,6})[ \t\n\r\f]?/g, (_m, hex: string) => {
        const cp = Number.parseInt(hex, 16)
        return cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)
          ? "�"
          : String.fromCodePoint(cp)
      })
      .replace(/\\(.)/gs, "$1")
      .replace(/\/\*[\s\S]*?(?:\*\/|$)/g, "")
      // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping NUL is the purpose
      .replace(/\u0000/g, "")
  )
}

/** Extract the target id from a local `#id` reference, or `null`. */
export function localRefId(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed.startsWith("#")) return null
  const id = trimmed.slice(1)
  return SAFE_ID.test(id) ? id : null
}

/**
 * Check every `url(...)` in a (CSS-decoded) value. Returns the referenced ids,
 * or `null` when any reference is not a local `url(#id)`.
 */
function localUrlRefs(decoded: string): string[] | null {
  const opens = decoded.match(/url\s*\(/gi)?.length ?? 0
  const ids: string[] = []
  const pattern = /url\s*\(([^)]*)\)/gi
  let count = 0
  for (const match of decoded.matchAll(pattern)) {
    count += 1
    const inner = (match[1] ?? "").trim().replace(/^(['"])(.*)\1$/s, "$2")
    const id = localRefId(inner)
    if (id === null) return null
    ids.push(id)
  }
  return count === opens ? ids : null
}

/** Script-executing URL schemes; never allowed in any attribute value. */
const SCRIPT_SCHEME = /(?:java|vb|live)script\s*:/i
/** Additionally refused in non-text attributes: `data:` URIs and legacy CSS `expression()`. */
const DANGEROUS_SCHEME = /data\s*:|expression\s*\(/i

interface Context {
  readonly removed: Removal[]
  readonly options: Required<SanitizeOptions>
  geometry: number
}

function removeAttr(ctx: Context, element: string, name: string, reason: RemovalReason): void {
  ctx.removed.push({ kind: "attribute", name, element, reason })
}

function filterAttributes(el: XmlElement, ctx: Context): Map<string, string> {
  const out = new Map<string, string>()
  const hasPlainHref = el.attrs.some((attr) => attr.name === "href")
  for (const { name: rawName, value } of el.attrs) {
    // Namespace declarations are normalized away; the root gets the SVG namespace back.
    if (rawName === "xmlns" || rawName.startsWith("xmlns:")) continue
    if (/^on/i.test(rawName)) {
      removeAttr(ctx, el.name, rawName, "event-handler")
      continue
    }
    if (rawName === "style") {
      removeAttr(ctx, el.name, rawName, "unsafe-style")
      continue
    }
    // `xlink:href` is rewritten to SVG 2 `href` so no xlink namespace is needed.
    let name = rawName
    if (rawName === "xlink:href") {
      if (hasPlainHref) {
        removeAttr(ctx, el.name, rawName, "not-allowed")
        continue
      }
      name = "href"
    }
    if (!ALLOWED_ATTRIBUTES.has(name)) {
      removeAttr(ctx, el.name, rawName, "not-allowed")
      continue
    }
    if (name === "href") {
      const isLocal = localRefId(value) !== null
      const isImageData =
        el.name === "image" && ctx.options.allowImages && SAFE_RASTER_DATA_URI.test(value.trim())
      if (!isLocal && !isImageData) {
        removeAttr(ctx, el.name, rawName, "unsafe-url")
        continue
      }
      out.set("href", value.trim())
      continue
    }
    if (name === "id" && !SAFE_ID.test(value)) {
      removeAttr(ctx, el.name, name, "invalid-id")
      continue
    }
    const decoded = decodeCssEscapes(value)
    // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters can hide a scheme
    const compact = decoded.replace(/[\s\u0000-\u001f]+/g, "")
    if (SCRIPT_SCHEME.test(decoded) || SCRIPT_SCHEME.test(compact)) {
      removeAttr(ctx, el.name, name, "unsafe-url")
      continue
    }
    if (name !== "aria-label") {
      if (/url\s*\(/i.test(decoded) || /url\(/i.test(compact)) {
        if (localUrlRefs(decoded) === null) {
          removeAttr(ctx, el.name, name, "unsafe-url")
          continue
        }
      }
      if (DANGEROUS_SCHEME.test(decoded) || DANGEROUS_SCHEME.test(compact)) {
        removeAttr(ctx, el.name, name, "unsafe-url")
        continue
      }
    }
    if (BOUNDED_ATTRIBUTES.has(name)) {
      const numbers = value.match(NUMBER) ?? []
      const outOfRange = numbers.some((n) => {
        const parsed = Number(n)
        return !Number.isFinite(parsed) || Math.abs(parsed) > ctx.options.maxCoordinate
      })
      if (outOfRange) {
        removeAttr(ctx, el.name, name, "out-of-range")
        continue
      }
    }
    if (name === "d" || name === "points") ctx.geometry += value.length
    out.set(name, value)
  }
  return out
}

function filterElement(el: XmlElement, parent: SNode | null, ctx: Context): SNode | null {
  const allowed = ALLOWED_ELEMENTS.has(el.name) || (el.name === "image" && ctx.options.allowImages)
  if (!allowed) {
    ctx.removed.push({ kind: "element", name: el.name, reason: "not-allowed" })
    return null
  }
  const node: SNode = { name: el.name, attrs: filterAttributes(el, ctx), children: [], parent }
  const keepsText = TEXT_CONTAINERS.has(el.name)
  for (const child of el.children) {
    const filtered = filterChild(child, node, keepsText, ctx)
    if (filtered !== null) node.children.push(filtered)
  }
  return node
}

function filterChild(
  child: XmlNode,
  parent: SNode,
  keepsText: boolean,
  ctx: Context,
): SNode | string | null {
  switch (child.type) {
    case "element":
      return filterElement(child, parent, ctx)
    case "text":
      if (keepsText) return child.value
      if (child.value.trim() !== "") {
        ctx.removed.push({ kind: "node", name: "#text", reason: "stray-text" })
      }
      return null
    case "cdata":
      ctx.removed.push({ kind: "node", name: "#cdata", reason: "cdata" })
      return null
    case "comment":
      ctx.removed.push({ kind: "node", name: "#comment", reason: "comment" })
      return null
    case "pi":
      ctx.removed.push({ kind: "node", name: child.target, reason: "processing-instruction" })
      return null
  }
}

function* walk(node: SNode): Generator<SNode> {
  const stack: SNode[] = [node]
  for (let current = stack.pop(); current !== undefined; current = stack.pop()) {
    yield current
    for (let i = current.children.length - 1; i >= 0; i -= 1) {
      const child = current.children[i]
      if (child !== undefined && typeof child !== "string") stack.push(child)
    }
  }
}

/** Drop duplicate ids, dangling `href`-dependent elements, and dangling attribute refs. */
function enforceReferenceIntegrity(root: SNode, ctx: Context): void {
  const ids = new Map<string, SNode>()
  for (const node of walk(root)) {
    const id = node.attrs.get("id")
    if (id === undefined) continue
    if (ids.has(id)) {
      node.attrs.delete("id")
      removeAttr(ctx, node.name, "id", "duplicate-id")
    } else ids.set(id, node)
  }

  // Elements that cannot exist without their href target. Removing one can
  // orphan others, so propagate with a worklist (linear in document size).
  const referrers = new Map<string, SNode[]>()
  const queue: SNode[] = []
  for (const node of walk(root)) {
    if (!REQUIRES_HREF.has(node.name)) continue
    const href = node.attrs.get("href")
    if (href === undefined) {
      queue.push(node)
      continue
    }
    if (href.startsWith("data:")) continue
    const target = localRefId(href)
    if (target === null || !ids.has(target)) queue.push(node)
    else {
      const list = referrers.get(target) ?? []
      list.push(node)
      referrers.set(target, list)
    }
  }
  const dead = new Set<SNode>()
  for (let node = queue.pop(); node !== undefined; node = queue.pop()) {
    if (dead.has(node)) continue
    let ancestorDead = false
    for (let p = node.parent; p !== null; p = p.parent) {
      if (dead.has(p)) {
        ancestorDead = true
        break
      }
    }
    if (ancestorDead) continue
    ctx.removed.push({ kind: "element", name: node.name, reason: "dangling-reference" })
    for (const inner of walk(node)) {
      if (dead.has(inner)) continue
      dead.add(inner)
      const id = inner.attrs.get("id")
      if (id !== undefined && ids.get(id) === inner) {
        ids.delete(id)
        for (const referrer of referrers.get(id) ?? []) queue.push(referrer)
      }
    }
  }
  if (dead.has(root)) dead.delete(root)
  for (const node of walk(root)) {
    node.children = node.children.filter((child) => typeof child === "string" || !dead.has(child))
  }

  // Attribute-level references: drop the attribute, keep the element.
  for (const node of walk(root)) {
    for (const [name, value] of [...node.attrs]) {
      if (name === "id") continue
      if (name === "href") {
        if (value.startsWith("data:")) continue
        const target = localRefId(value)
        if (target === null || !ids.has(target)) {
          node.attrs.delete(name)
          removeAttr(ctx, node.name, name, "dangling-reference")
        }
        continue
      }
      if (IDREF_LIST_ATTRIBUTES.has(name)) {
        const tokens = value.split(/\s+/).filter((token) => token !== "")
        const kept = tokens.filter((token) => ids.has(token))
        if (kept.length === tokens.length) continue
        removeAttr(ctx, node.name, name, "dangling-reference")
        if (kept.length === 0) node.attrs.delete(name)
        else node.attrs.set(name, kept.join(" "))
        continue
      }
      const refs = localUrlRefs(decodeCssEscapes(value))
      if (refs?.some((id) => !ids.has(id))) {
        node.attrs.delete(name)
        removeAttr(ctx, node.name, name, "dangling-reference")
      }
    }
  }
}

/**
 * Count rendered elements with every `<use>` expanded. Returns `"cycle"` when a
 * `<use>` (transitively) references itself. Iterative, saturating at `limit + 1`.
 */
function renderedElementCount(root: SNode, limit: number): number | "cycle" {
  const ids = new Map<string, SNode>()
  for (const node of walk(root)) {
    const id = node.attrs.get("id")
    if (id !== undefined) ids.set(id, node)
  }
  const deps = (node: SNode): SNode[] => {
    const out = node.children.filter((child): child is SNode => typeof child !== "string")
    if (node.name === "use") {
      const target = localRefId(node.attrs.get("href") ?? "")
      const resolved = target === null ? undefined : ids.get(target)
      if (resolved !== undefined) out.push(resolved)
    }
    return out
  }
  const state = new Map<SNode, 1 | 2>()
  const cost = new Map<SNode, number>()
  const stack: { node: SNode; expanded: boolean }[] = [{ node: root, expanded: false }]
  while (stack.length > 0) {
    const top = stack[stack.length - 1]
    if (top === undefined) break
    if (!top.expanded) {
      const status = state.get(top.node)
      if (status === 2) {
        stack.pop()
        continue
      }
      if (status === 1) return "cycle"
      state.set(top.node, 1)
      top.expanded = true
      for (const dep of deps(top.node)) {
        const depStatus = state.get(dep)
        if (depStatus === 1) return "cycle"
        if (depStatus !== 2) stack.push({ node: dep, expanded: false })
      }
    } else {
      let total = 1
      for (const dep of deps(top.node)) total = Math.min(limit + 1, total + (cost.get(dep) ?? 0))
      cost.set(top.node, total)
      state.set(top.node, 2)
      stack.pop()
    }
  }
  return cost.get(root) ?? 0
}

function serialize(node: SNode, isRoot: boolean): string {
  let attrs = isRoot ? ` xmlns="${SVG_NS}"` : ""
  for (const [name, value] of node.attrs) attrs += ` ${name}="${escapeXmlAttr(value)}"`
  let inner = ""
  for (const child of node.children) {
    inner += typeof child === "string" ? escapeXmlText(child) : serialize(child, false)
  }
  return inner === "" ? `<${node.name}${attrs}/>` : `<${node.name}${attrs}>${inner}</${node.name}>`
}

/** Defense in depth: no tag in the output may carry an executable construct. */
function hasResidualDanger(svg: string): boolean {
  for (const tag of svg.matchAll(/<[^>]*>/g)) {
    const text = tag[0]
    const structure = text.replace(/"[^"]*"/g, '""')
    if (/^<\/?(?:script|style|foreignObject|iframe|object|embed|a)\b/i.test(structure)) return true
    if (/\son[a-z]+\s*=/i.test(structure) || /^<[!?]/.test(structure)) return true
    if (/(?:java|vb|live)script\s*:/i.test(text)) return true
  }
  return false
}

const DEFAULTS: Required<SanitizeOptions> = {
  maxBytes: 8 * 1024 * 1024,
  maxDepth: 100,
  maxNodes: 100_000,
  maxGeometryBytes: 4 * 1024 * 1024,
  maxCoordinate: 1e6,
  maxRenderedElements: 1_000_000,
  allowImages: false,
}

/**
 * Sanitize untrusted SVG markup.
 *
 * @example
 * ```ts
 * const result = sanitizeSvg('<svg onload="alert(1)"><rect width="4" height="4"/></svg>')
 * // { ok: true, svg: '<svg xmlns="http://www.w3.org/2000/svg"><rect width="4" height="4"/></svg>',
 * //   removed: [{ kind: "attribute", name: "onload", element: "svg", reason: "event-handler" }] }
 * ```
 */
export function sanitizeSvg(input: string, options: SanitizeOptions = {}): SanitizeResult {
  const opts: Required<SanitizeOptions> = { ...DEFAULTS, ...options }
  const removed: Removal[] = []
  const fail = (reason: SanitizeFailureCode, message: string): SanitizeResult => ({
    ok: false,
    svg: null,
    removed,
    reason,
    message,
  })

  if (input.length > opts.maxBytes || utf8ByteLength(input) > opts.maxBytes) {
    return fail("too-large", `input exceeds ${opts.maxBytes} bytes`)
  }
  if (/<!(?:doctype|entity|element|attlist)\b/i.test(input)) {
    return fail("declaration", "DOCTYPE and ENTITY declarations are not allowed")
  }
  if (/<\?xml-stylesheet\b/i.test(input)) {
    return fail("stylesheet", "xml-stylesheet processing instructions are not allowed")
  }

  const parsed = parseXml(input.replace(/^\uFEFF/, ""), {
    maxDepth: opts.maxDepth,
    maxNodes: opts.maxNodes,
  })
  if (!parsed.ok) {
    const code = parsed.error.code === "declaration" ? "declaration" : parsed.error.code
    return fail(code, parsed.error.message)
  }

  const roots = parsed.nodes.filter((node): node is XmlElement => node.type === "element")
  const rootElement = roots[0]
  if (roots.length !== 1 || rootElement === undefined || rootElement.name !== "svg") {
    return fail("root", "document must have exactly one <svg> root element")
  }
  for (const node of parsed.nodes) {
    if (node.type === "comment") removed.push({ kind: "node", name: "#comment", reason: "comment" })
    else if (node.type === "pi") {
      removed.push({ kind: "node", name: node.target, reason: "processing-instruction" })
    }
  }

  const ctx: Context = { removed, options: opts, geometry: 0 }
  const root = filterElement(rootElement, null, ctx)
  if (root === null) return fail("root", "root element was removed")
  if (ctx.geometry > opts.maxGeometryBytes) {
    return fail("geometry-budget", `path data exceeds ${opts.maxGeometryBytes} bytes`)
  }

  enforceReferenceIntegrity(root, ctx)

  const rendered = renderedElementCount(root, opts.maxRenderedElements)
  if (rendered === "cycle") return fail("use-cycle", "<use> references form a cycle")
  if (rendered > opts.maxRenderedElements) {
    return fail("use-expansion", `<use> expansion exceeds ${opts.maxRenderedElements} elements`)
  }

  const svg = serialize(root, true)
  if (hasResidualDanger(svg)) return fail("residual-danger", "output failed the final safety check")
  return { ok: true, svg, removed }
}
