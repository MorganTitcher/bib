/**
 * A declarative, zod-validated SVG description compiled to markup.
 *
 * Documents are plain JSON-shaped data (shapes, text, groups, gradients and a
 * viewBox), so they can come from configuration, an API or a model and still be
 * rendered safely: every field is validated, every string is escaped, colors are
 * hex only, paint references must point at a declared gradient, and path data is
 * restricted to the path-command alphabet. Nothing in the schema can express
 * script, event handlers, external references or CSS.
 *
 * @example
 * ```ts
 * const result = compileSvg({
 *   width: 64,
 *   height: 64,
 *   title: "Status",
 *   children: [{ type: "circle", cx: 32, cy: 32, r: 30, fill: "#2f9e44" }],
 * })
 * if (result.ok) result.value
 * // '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64" role="img">…'
 * ```
 */
import { err, ok, type Result } from "@bib/shared/result"
import { z } from "zod"
import { type Attrs, h, type Markup, svg } from "./element.ts"
import { formatNumber } from "./escape.ts"
import { SAFE_ID } from "./sanitize.ts"

/** Largest absolute coordinate or length accepted anywhere in a document. */
export const DSL_MAX_COORDINATE = 1_000_000
/** Maximum nesting depth of groups (including the root). */
export const DSL_MAX_DEPTH = 32
/** Maximum number of objects (nodes, stops, points, ...) in an input. */
export const DSL_MAX_NODES = 10_000
/** Maximum length of a single path `d` string. */
export const DSL_MAX_PATH_LENGTH = 100_000

const coord = z.number().min(-DSL_MAX_COORDINATE).max(DSL_MAX_COORDINATE)
const length = z.number().min(0).max(DSL_MAX_COORDINATE)
const positive = z.number().gt(0).max(DSL_MAX_COORDINATE)
const unit = z.number().min(0).max(1)
const id = z.string().regex(SAFE_ID, "must be a letter or underscore followed by [A-Za-z0-9_-]")
const hex = z
  .string()
  .regex(
    /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/,
    "must be a hex color",
  )

/** A paint: `"none"`, `"currentColor"`, a hex color or a reference to a gradient id. */
export const paintSchema = z.union([
  z.literal("none"),
  z.literal("currentColor"),
  hex,
  z.strictObject({ ref: id }),
])
export type Paint = z.infer<typeof paintSchema>

/** A structured transform, applied as translate, then rotate, then scale. */
export const transformSchema = z.strictObject({
  translate: z.tuple([coord, coord]).optional(),
  rotate: z.union([coord, z.tuple([coord, coord, coord])]).optional(),
  scale: z.union([positive, z.tuple([positive, positive])]).optional(),
})
export type Transform = z.infer<typeof transformSchema>

const presentation = {
  id: id.optional(),
  fill: paintSchema.optional(),
  stroke: paintSchema.optional(),
  strokeWidth: length.optional(),
  opacity: unit.optional(),
  transform: transformSchema.optional(),
}

const rectSchema = z.strictObject({
  type: z.literal("rect"),
  x: coord.optional(),
  y: coord.optional(),
  width: length,
  height: length,
  rx: length.optional(),
  ry: length.optional(),
  ...presentation,
})
const circleSchema = z.strictObject({
  type: z.literal("circle"),
  cx: coord,
  cy: coord,
  r: length,
  ...presentation,
})
const ellipseSchema = z.strictObject({
  type: z.literal("ellipse"),
  cx: coord,
  cy: coord,
  rx: length,
  ry: length,
  ...presentation,
})
const lineSchema = z.strictObject({
  type: z.literal("line"),
  x1: coord,
  y1: coord,
  x2: coord,
  y2: coord,
  ...presentation,
})
const pointList = z.array(z.tuple([coord, coord])).min(2)
const polylineSchema = z.strictObject({
  type: z.literal("polyline"),
  points: pointList,
  ...presentation,
})
const polygonSchema = z.strictObject({
  type: z.literal("polygon"),
  points: pointList,
  ...presentation,
})
const pathSchema = z.strictObject({
  type: z.literal("path"),
  d: z
    .string()
    .min(1)
    .max(DSL_MAX_PATH_LENGTH)
    .regex(/^[MmLlHhVvCcSsQqTtAaZz0-9eE.,+\-\s]+$/, "must contain only path commands and numbers")
    .regex(/^\s*[Mm]/, "must start with a moveto command"),
  ...presentation,
})
const fontFamily = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9 ,'"_-]+$/, "must be a plain font-family list")
const textSchema = z.strictObject({
  type: z.literal("text"),
  x: coord,
  y: coord,
  content: z.string().max(2000),
  fontSize: positive.optional(),
  fontFamily: fontFamily.optional(),
  fontWeight: z
    .union([z.literal("normal"), z.literal("bold"), z.number().int().min(1).max(1000)])
    .optional(),
  textAnchor: z.enum(["start", "middle", "end"]).optional(),
  ...presentation,
})

/** A shape or text node (anything but a group). */
export type LeafNode =
  | z.infer<typeof rectSchema>
  | z.infer<typeof circleSchema>
  | z.infer<typeof ellipseSchema>
  | z.infer<typeof lineSchema>
  | z.infer<typeof polylineSchema>
  | z.infer<typeof polygonSchema>
  | z.infer<typeof pathSchema>
  | z.infer<typeof textSchema>

/** A group of child nodes sharing presentation attributes. */
export interface GroupNode {
  type: "g"
  children: SvgNode[]
  id?: string | undefined
  fill?: Paint | undefined
  stroke?: Paint | undefined
  strokeWidth?: number | undefined
  opacity?: number | undefined
  transform?: Transform | undefined
}

/** Any drawable node. */
export type SvgNode = LeafNode | GroupNode

/** Schema for a drawable node; groups recurse. */
export const nodeSchema: z.ZodType<SvgNode> = z.lazy(() =>
  z.discriminatedUnion("type", [
    rectSchema,
    circleSchema,
    ellipseSchema,
    lineSchema,
    polylineSchema,
    polygonSchema,
    pathSchema,
    textSchema,
    z.strictObject({ type: z.literal("g"), children: z.array(nodeSchema), ...presentation }),
  ]),
)

const stopSchema = z.strictObject({
  offset: unit,
  color: hex,
  opacity: unit.optional(),
})
const stops = z.array(stopSchema).min(2).max(64)

const linearGradientSchema = z.strictObject({
  type: z.literal("linearGradient"),
  id,
  x1: unit.optional(),
  y1: unit.optional(),
  x2: unit.optional(),
  y2: unit.optional(),
  stops,
})
const radialGradientSchema = z.strictObject({
  type: z.literal("radialGradient"),
  id,
  cx: unit.optional(),
  cy: unit.optional(),
  r: unit.optional(),
  fx: unit.optional(),
  fy: unit.optional(),
  stops,
})

/** A gradient definition. Coordinates are fractions of the painted object's box. */
export const gradientSchema = z.discriminatedUnion("type", [
  linearGradientSchema,
  radialGradientSchema,
])
export type Gradient = z.infer<typeof gradientSchema>

/** The document root. `title` is required so every output has an accessible name. */
export const svgDocumentSchema = z.strictObject({
  width: positive,
  height: positive,
  viewBox: z.tuple([coord, coord, positive, positive]).optional(),
  title: z
    .string()
    .max(500)
    .refine((value) => value.trim() !== "", "must not be blank"),
  desc: z.string().max(2000).optional(),
  defs: z.array(gradientSchema).max(256).optional(),
  children: z.array(nodeSchema),
})
export type SvgDocument = z.infer<typeof svgDocumentSchema>

/** One validation problem, with a dotted path into the input. */
export interface DslIssue {
  readonly path: string
  readonly message: string
}

/** Options for {@link compileSvg}. */
export interface CompileOptions {
  readonly maxDepth?: number
  readonly maxNodes?: number
}

function formatPath(path: readonly PropertyKey[]): string {
  return path
    .map((part) => (typeof part === "number" ? `[${part}]` : `.${String(part)}`))
    .join("")
    .replace(/^\./, "")
}

/** Bound depth and object count before handing the input to zod's recursive parser. */
function checkBounds(input: unknown, maxDepth: number, maxNodes: number): DslIssue | null {
  let count = 0
  const stack: { value: unknown; depth: number }[] = [{ value: input, depth: 1 }]
  while (stack.length > 0) {
    const item = stack.pop()
    if (item === undefined) break
    const { value, depth } = item
    if (value === null || typeof value !== "object") continue
    count += 1
    if (count > maxNodes) return { path: "", message: `input has more than ${maxNodes} objects` }
    if (depth > maxDepth * 2 + 2) {
      return { path: "", message: `input is nested deeper than ${maxDepth} groups` }
    }
    const children = Array.isArray(value) ? value : Object.values(value)
    for (const child of children) stack.push({ value: child, depth: depth + 1 })
  }
  return null
}

function groupDepth(nodes: readonly SvgNode[]): number {
  let max = 0
  const stack: { nodes: readonly SvgNode[]; depth: number }[] = [{ nodes, depth: 1 }]
  while (stack.length > 0) {
    const item = stack.pop()
    if (item === undefined) break
    max = Math.max(max, item.depth)
    for (const node of item.nodes) {
      if (node.type === "g") stack.push({ nodes: node.children, depth: item.depth + 1 })
    }
  }
  return max
}

function n(value: number): string {
  return formatNumber(value)
}

function paint(value: Paint | undefined): string | undefined {
  if (value === undefined) return undefined
  return typeof value === "string" ? value : `url(#${value.ref})`
}

function transformAttr(value: Transform | undefined): string | undefined {
  if (value === undefined) return undefined
  const parts: string[] = []
  if (value.translate) parts.push(`translate(${n(value.translate[0])} ${n(value.translate[1])})`)
  if (value.rotate !== undefined) {
    parts.push(
      typeof value.rotate === "number"
        ? `rotate(${n(value.rotate)})`
        : `rotate(${value.rotate.map(n).join(" ")})`,
    )
  }
  if (value.scale !== undefined) {
    parts.push(
      typeof value.scale === "number"
        ? `scale(${n(value.scale)})`
        : `scale(${n(value.scale[0])} ${n(value.scale[1])})`,
    )
  }
  return parts.length > 0 ? parts.join(" ") : undefined
}

function common(node: SvgNode): Record<string, string | undefined> {
  return {
    id: node.id,
    fill: paint(node.fill),
    stroke: paint(node.stroke),
    "stroke-width": node.strokeWidth === undefined ? undefined : n(node.strokeWidth),
    opacity: node.opacity === undefined ? undefined : n(node.opacity),
    transform: transformAttr(node.transform),
  }
}

function num(value: number | undefined): string | undefined {
  return value === undefined ? undefined : n(value)
}

function points(list: readonly (readonly [number, number])[]): string {
  return list.map(([x, y]) => `${n(x)},${n(y)}`).join(" ")
}

function renderNode(node: SvgNode): Markup {
  const base = common(node)
  switch (node.type) {
    case "rect":
      return h("rect", {
        x: num(node.x),
        y: num(node.y),
        width: n(node.width),
        height: n(node.height),
        rx: num(node.rx),
        ry: num(node.ry),
        ...base,
      })
    case "circle":
      return h("circle", { cx: n(node.cx), cy: n(node.cy), r: n(node.r), ...base })
    case "ellipse":
      return h("ellipse", {
        cx: n(node.cx),
        cy: n(node.cy),
        rx: n(node.rx),
        ry: n(node.ry),
        ...base,
      })
    case "line":
      return h("line", { x1: n(node.x1), y1: n(node.y1), x2: n(node.x2), y2: n(node.y2), ...base })
    case "polyline":
      return h("polyline", { points: points(node.points), ...base })
    case "polygon":
      return h("polygon", { points: points(node.points), ...base })
    case "path":
      return h("path", { d: node.d.trim().replace(/\s+/g, " "), ...base })
    case "text":
      return h(
        "text",
        {
          x: n(node.x),
          y: n(node.y),
          "font-size": num(node.fontSize),
          "font-family": node.fontFamily,
          "font-weight": node.fontWeight === undefined ? undefined : String(node.fontWeight),
          "text-anchor": node.textAnchor,
          ...base,
        },
        node.content,
      )
    case "g":
      return h("g", base, node.children.map(renderNode))
  }
}

function renderGradient(gradient: Gradient): Markup {
  const stopsMarkup = gradient.stops.map((stop) =>
    h("stop", {
      offset: n(stop.offset),
      "stop-color": stop.color,
      "stop-opacity": num(stop.opacity),
    }),
  )
  const attrs: Attrs =
    gradient.type === "linearGradient"
      ? {
          id: gradient.id,
          x1: num(gradient.x1),
          y1: num(gradient.y1),
          x2: num(gradient.x2),
          y2: num(gradient.y2),
        }
      : {
          id: gradient.id,
          cx: num(gradient.cx),
          cy: num(gradient.cy),
          r: num(gradient.r),
          fx: num(gradient.fx),
          fy: num(gradient.fy),
        }
  return h(gradient.type, attrs, stopsMarkup)
}

function checkReferences(doc: SvgDocument): DslIssue[] {
  const issues: DslIssue[] = []
  const seen = new Set<string>()
  const claim = (value: string, path: string): void => {
    if (seen.has(value)) issues.push({ path, message: `duplicate id "${value}"` })
    seen.add(value)
  }
  const gradientIds = new Set<string>()
  ;(doc.defs ?? []).forEach((gradient, index) => {
    claim(gradient.id, `defs[${index}].id`)
    gradientIds.add(gradient.id)
  })
  const refs: [string, string][] = []
  const stack: { node: SvgNode; path: string }[] = doc.children
    .map((node, index) => ({ node, path: `children[${index}]` }))
    .reverse()
  while (stack.length > 0) {
    const item = stack.pop()
    if (item === undefined) break
    const { node, path } = item
    if (node.id !== undefined) claim(node.id, `${path}.id`)
    for (const key of ["fill", "stroke"] as const) {
      const value = node[key]
      if (value !== undefined && typeof value !== "string") refs.push([value.ref, `${path}.${key}`])
    }
    if (node.type === "g") {
      for (let index = node.children.length - 1; index >= 0; index -= 1) {
        const child = node.children[index]
        if (child) stack.push({ node: child, path: `${path}.children[${index}]` })
      }
    }
  }
  for (const [target, path] of refs) {
    if (!gradientIds.has(target)) {
      issues.push({ path, message: `references unknown gradient "${target}"` })
    }
  }
  return issues
}

/** Validate unknown input as an {@link SvgDocument}, including reference and depth checks. */
export function parseSvgDocument(
  input: unknown,
  options: CompileOptions = {},
): Result<SvgDocument, DslIssue[]> {
  const maxDepth = options.maxDepth ?? DSL_MAX_DEPTH
  const maxNodes = options.maxNodes ?? DSL_MAX_NODES
  const bounds = checkBounds(input, maxDepth, maxNodes)
  if (bounds) return err([bounds])
  const parsed = svgDocumentSchema.safeParse(input)
  if (!parsed.success) {
    return err(
      parsed.error.issues.map((issue) => ({
        path: formatPath(issue.path),
        message: issue.message,
      })),
    )
  }
  const doc = parsed.data
  if (groupDepth(doc.children) > maxDepth) {
    return err([{ path: "children", message: `groups are nested deeper than ${maxDepth}` }])
  }
  const refIssues = checkReferences(doc)
  return refIssues.length > 0 ? err(refIssues) : ok(doc)
}

/** Render an already-validated document. Prefer {@link compileSvg} for untrusted input. */
export function renderSvgDocument(doc: SvgDocument): string {
  const viewBox = doc.viewBox ?? [0, 0, doc.width, doc.height]
  const defs = doc.defs && doc.defs.length > 0 ? h("defs", {}, doc.defs.map(renderGradient)) : null
  return svg(
    {
      width: n(doc.width),
      height: n(doc.height),
      viewBox: viewBox.map(n).join(" "),
      role: "img",
    },
    h("title", {}, doc.title),
    doc.desc === undefined ? null : h("desc", {}, doc.desc),
    defs,
    doc.children.map(renderNode),
  ).value
}

/** Validate unknown input and compile it to SVG markup. Never throws on bad input. */
export function compileSvg(
  input: unknown,
  options: CompileOptions = {},
): Result<string, DslIssue[]> {
  const parsed = parseSvgDocument(input, options)
  return parsed.ok ? ok(renderSvgDocument(parsed.value)) : parsed
}
