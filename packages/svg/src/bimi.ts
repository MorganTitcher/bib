/**
 * Checks for the SVG Tiny Portable/Secure (SVG Tiny PS) profile that BIMI
 * brand-indicator logos must follow.
 *
 * Reports every violation found rather than stopping at the first. Errors are
 * profile requirements; warnings are strong recommendations (a solid
 * background). Passing these checks is necessary, not sufficient: mark
 * certificate issuers and mailbox providers apply their own review.
 */
import { localRefId, utf8ByteLength } from "./sanitize.ts"
import { getAttr, parseXml, type XmlElement, type XmlNode } from "./xml.ts"

/** Maximum logo size recommended for BIMI, in bytes. */
export const BIMI_MAX_BYTES = 32 * 1024

/** Minimum rendered width/height when dimensions are given, in px. */
export const BIMI_MIN_SIZE = 96

/** Elements the profile permits. */
export const BIMI_ALLOWED_ELEMENTS: ReadonlySet<string> = new Set([
  "svg",
  "title",
  "desc",
  "metadata",
  "defs",
  "g",
  "use",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "linearGradient",
  "radialGradient",
  "stop",
  "solidColor",
])

const FORBIDDEN_REASONS: Readonly<Record<string, string>> = {
  script: "scripts are not allowed",
  style: "style sheets are not allowed",
  animate: "animation is not allowed",
  animateMotion: "animation is not allowed",
  animateTransform: "animation is not allowed",
  animateColor: "animation is not allowed",
  set: "animation is not allowed",
  filter: "filters are not allowed",
  image: "embedded or linked raster images are not allowed",
  foreignObject: "foreign content is not allowed",
  a: "links are not allowed",
  pattern: "patterns are not allowed",
  mask: "masks are not allowed",
  symbol: "symbols are not part of the profile",
  marker: "markers are not part of the profile",
  switch: "conditional processing is not allowed",
  cursor: "cursors are not allowed",
  text: "text must be converted to paths",
  tspan: "text must be converted to paths",
  textPath: "text must be converted to paths",
  font: "fonts are not allowed",
  "font-face": "fonts are not allowed",
}

export type BimiViolationCode =
  | "too-large"
  | "dtd"
  | "stylesheet-pi"
  | "malformed"
  | "root"
  | "version"
  | "base-profile"
  | "namespace"
  | "viewbox"
  | "root-position"
  | "dimensions"
  | "title"
  | "forbidden-element"
  | "unknown-element"
  | "event-handler"
  | "inline-style"
  | "xml-base"
  | "external-reference"
  | "no-opaque-background"

export interface BimiViolation {
  readonly code: BimiViolationCode
  readonly severity: "error" | "warning"
  readonly message: string
  readonly element?: string
  readonly attribute?: string
}

export interface BimiReport {
  /** True when there are no `error`-severity violations. */
  readonly ok: boolean
  readonly violations: readonly BimiViolation[]
}

const SVG_NS = "http://www.w3.org/2000/svg"
const NUMBER = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/

function parseViewBox(value: string | undefined): [number, number, number, number] | null {
  if (value === undefined) return null
  const parts = value.trim().split(/[\s,]+/)
  if (parts.length !== 4 || !parts.every((p) => NUMBER.test(p))) return null
  const [x, y, w, h] = parts.map(Number) as [number, number, number, number]
  return w > 0 && h > 0 ? [x, y, w, h] : null
}

/** Absolute length in px (`"128"` or `"128px"`), or `null` for relative or invalid values. */
function absolutePx(value: string): number | null {
  const match = /^\s*([-+]?(?:\d+\.?\d*|\.\d+))(px)?\s*$/.exec(value)
  return match?.[1] === undefined ? null : Number(match[1])
}

function isOpaquePaint(element: XmlElement): boolean {
  const fill = (getAttr(element, "fill") ?? "#000").trim().toLowerCase()
  if (fill === "none" || fill === "transparent" || fill.startsWith("url(")) return false
  if (
    /^#(?:[0-9a-f]{4}|[0-9a-f]{8})$/.test(fill) &&
    !/^#(?:[0-9a-f]{3}f|[0-9a-f]{6}ff)$/.test(fill)
  ) {
    return false
  }
  for (const name of ["opacity", "fill-opacity"]) {
    const value = getAttr(element, name)
    if (value !== undefined && Number(value) < 1) return false
  }
  return true
}

function coversViewBox(rect: XmlElement, box: [number, number, number, number]): boolean {
  const [bx, by, bw, bh] = box
  const length = (name: string, full: number, fallback: string): boolean | number => {
    const raw = (getAttr(rect, name) ?? fallback).trim()
    if (raw === "100%") return full
    const px = absolutePx(raw)
    return px === null ? false : px
  }
  const x = length("x", bx, "0")
  const y = length("y", by, "0")
  const w = length("width", bw, "0")
  const hh = length("height", bh, "0")
  if (
    typeof x !== "number" ||
    typeof y !== "number" ||
    typeof w !== "number" ||
    typeof hh !== "number"
  ) {
    return false
  }
  if (getAttr(rect, "transform") !== undefined) return false
  return x <= bx && y <= by && x + w >= bx + bw && y + hh >= by + bh
}

const DRAWING = new Set(["path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "use"])

function firstDrawing(nodes: readonly XmlNode[]): XmlElement | null {
  for (const node of nodes) {
    if (node.type !== "element" || node.name === "defs") continue
    if (DRAWING.has(node.name)) return node
    if (node.name === "g") {
      const found = firstDrawing(node.children)
      if (found !== null) return found
    }
  }
  return null
}

/**
 * Check an SVG against the SVG Tiny PS profile used for BIMI logos.
 *
 * @example
 * ```ts
 * checkBimiSvg('<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny-ps" viewBox="0 0 100 100"><title>Example</title><rect width="100" height="100" fill="#123456"/></svg>')
 * // { ok: true, violations: [] }
 * ```
 */
export function checkBimiSvg(input: string): BimiReport {
  const violations: BimiViolation[] = []
  const error = (
    code: BimiViolationCode,
    message: string,
    extra: Partial<BimiViolation> = {},
  ): void => {
    violations.push({ code, severity: "error", message, ...extra })
  }
  const report = (): BimiReport => ({
    ok: violations.every((v) => v.severity !== "error"),
    violations,
  })

  const bytes = utf8ByteLength(input)
  if (bytes > BIMI_MAX_BYTES)
    error("too-large", `file is ${bytes} bytes; the limit is ${BIMI_MAX_BYTES}`)
  if (/<!(?:doctype|entity)\b/i.test(input)) {
    error("dtd", "DOCTYPE and ENTITY declarations are not allowed")
    return report()
  }
  if (/<\?xml-stylesheet\b/i.test(input))
    error("stylesheet-pi", "xml-stylesheet instructions are not allowed")

  const parsed = parseXml(input.replace(/^\uFEFF/, ""))
  if (!parsed.ok) {
    error("malformed", `not well-formed XML: ${parsed.error.message}`)
    return report()
  }
  const roots = parsed.nodes.filter((node): node is XmlElement => node.type === "element")
  const root = roots[0]
  if (roots.length !== 1 || root === undefined || root.name !== "svg") {
    error("root", "document must have exactly one <svg> root element")
    return report()
  }

  if (getAttr(root, "xmlns") !== SVG_NS) error("namespace", `root must declare xmlns="${SVG_NS}"`)
  if (getAttr(root, "version") !== "1.2") error("version", 'root must have version="1.2"')
  if (getAttr(root, "baseProfile") !== "tiny-ps")
    error("base-profile", 'root must have baseProfile="tiny-ps"')
  for (const name of ["x", "y"]) {
    if (getAttr(root, name) !== undefined) {
      error("root-position", `root must not have an ${name} attribute`, {
        element: "svg",
        attribute: name,
      })
    }
  }
  const box = parseViewBox(getAttr(root, "viewBox"))
  if (box === null) error("viewbox", "root needs a valid viewBox with positive width and height")
  else if (box[2] !== box[3]) error("viewbox", `viewBox must be square; got ${box[2]}x${box[3]}`)

  const widthAttr = getAttr(root, "width")
  const heightAttr = getAttr(root, "height")
  const sizes: number[] = []
  for (const [name, value] of [
    ["width", widthAttr],
    ["height", heightAttr],
  ] as const) {
    if (value === undefined) continue
    const px = absolutePx(value)
    if (px === null)
      error("dimensions", `${name} must be an absolute px length`, {
        element: "svg",
        attribute: name,
      })
    else if (px < BIMI_MIN_SIZE) {
      error("dimensions", `${name} must be at least ${BIMI_MIN_SIZE}px`, {
        element: "svg",
        attribute: name,
      })
    } else sizes.push(px)
  }
  if (sizes.length === 2 && sizes[0] !== sizes[1])
    error("dimensions", "width and height must be equal")

  const firstChild = root.children.find((node) => node.type === "element")
  if (firstChild?.name !== "title")
    error("title", "<title> must be the first child element of <svg>")
  const titleElement = root.children.find(
    (node): node is XmlElement => node.type === "element" && node.name === "title",
  )
  const titleText = titleElement?.children
    .map((node) => (node.type === "text" || node.type === "cdata" ? node.value : ""))
    .join("")
    .trim()
  if (titleElement !== undefined && titleText === "") error("title", "<title> must not be empty")

  const visit = (element: XmlElement, isRoot: boolean): void => {
    const reason = FORBIDDEN_REASONS[element.name]
    if (reason !== undefined || (!isRoot && element.name === "svg")) {
      error("forbidden-element", reason ?? "nested <svg> is not allowed", { element: element.name })
    } else if (!BIMI_ALLOWED_ELEMENTS.has(element.name)) {
      error("unknown-element", `<${element.name}> is not part of SVG Tiny PS`, {
        element: element.name,
      })
    }
    for (const { name, value } of element.attrs) {
      const at = { element: element.name, attribute: name }
      if (/^on/i.test(name)) error("event-handler", `${name} event handlers are not allowed`, at)
      else if (name === "style")
        error("inline-style", "inline style attributes are not allowed", at)
      else if (name === "xml:base") error("xml-base", "xml:base is not allowed", at)
      else if (name === "href" || name === "xlink:href") {
        if (localRefId(value) === null)
          error("external-reference", "references must be local (#id)", at)
      } else if (/url\s*\(/i.test(value)) {
        const refs = [...value.matchAll(/url\s*\(\s*(['"]?)([^)'"]*)\1\s*\)/gi)]
        if (refs.length === 0 || refs.some((m) => localRefId(m[2] ?? "") === null)) {
          error("external-reference", "url() references must be local (#id)", at)
        }
      }
    }
    // Metadata content is opaque (RDF and the like); do not walk it.
    if (element.name === "metadata") return
    for (const child of element.children) if (child.type === "element") visit(child, false)
  }
  visit(root, true)

  const drawing = firstDrawing(root.children)
  const opaque =
    drawing !== null &&
    drawing.name === "rect" &&
    box !== null &&
    coversViewBox(drawing, box) &&
    isOpaquePaint(drawing)
  if (!opaque) {
    violations.push({
      code: "no-opaque-background",
      severity: "warning",
      message: "first shape should be an opaque rectangle covering the viewBox (solid background)",
    })
  }
  return report()
}
