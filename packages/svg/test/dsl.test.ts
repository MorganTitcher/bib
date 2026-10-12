import { describe, expect, it } from "vitest"
import {
  compileSvg,
  DSL_MAX_COORDINATE,
  type DslIssue,
  parseSvgDocument,
  renderSvgDocument,
  type SvgDocument,
} from "../src/dsl.ts"
import { sanitizeSvg } from "../src/sanitize.ts"

const NS = 'xmlns="http://www.w3.org/2000/svg"'

function compiled(input: unknown): string {
  const result = compileSvg(input)
  if (!result.ok) throw new Error(JSON.stringify(result.error))
  return result.value
}

function issues(input: unknown): DslIssue[] {
  const result = compileSvg(input)
  if (result.ok) throw new Error(`expected issues, got ${result.value}`)
  return result.error
}

const base = { width: 100, height: 50, title: "Chart" }

describe("compileSvg", () => {
  it("compiles a minimal document with an accessible title", () => {
    expect(compiled({ ...base, children: [] })).toBe(
      `<svg ${NS} width="100" height="50" viewBox="0 0 100 50" role="img"><title>Chart</title></svg>`,
    )
  })
  it("compiles every shape", () => {
    const out = compiled({
      ...base,
      viewBox: [0, 0, 10, 5],
      desc: "All shapes",
      children: [
        { type: "rect", x: 1, y: 1, width: 2, height: 2, rx: 0.5, fill: "#ff0000" },
        { type: "circle", cx: 5, cy: 2, r: 1, stroke: "currentColor", strokeWidth: 0.25 },
        { type: "ellipse", cx: 5, cy: 2, rx: 2, ry: 1, fill: "none" },
        { type: "line", x1: 0, y1: 0, x2: 10, y2: 5, opacity: 0.5 },
        {
          type: "polyline",
          points: [
            [0, 0],
            [1, 1],
            [2, 0],
          ],
        },
        {
          type: "polygon",
          points: [
            [0, 0],
            [1, 1],
            [2, 0],
          ],
        },
        { type: "path", d: "M0 0 L 10   5 Z" },
      ],
    })
    expect(out).toContain('viewBox="0 0 10 5"')
    expect(out).toContain("<desc>All shapes</desc>")
    expect(out).toContain('<rect x="1" y="1" width="2" height="2" rx="0.5" fill="#ff0000"/>')
    expect(out).toContain('<circle cx="5" cy="2" r="1" stroke="currentColor" stroke-width="0.25"/>')
    expect(out).toContain('<polyline points="0,0 1,1 2,0"/>')
    expect(out).toContain('<path d="M0 0 L 10 5 Z"/>')
  })
  it("compiles text, groups, transforms and gradients", () => {
    const out = compiled({
      ...base,
      defs: [
        {
          type: "linearGradient",
          id: "fade",
          x2: 1,
          stops: [
            { offset: 0, color: "#fff" },
            { offset: 1, color: "#000", opacity: 0.5 },
          ],
        },
        {
          type: "radialGradient",
          id: "glow",
          r: 0.5,
          stops: [
            { offset: 0, color: "#fff" },
            { offset: 1, color: "#000" },
          ],
        },
      ],
      children: [
        {
          type: "g",
          id: "group",
          fill: { ref: "fade" },
          transform: { translate: [10, 5], rotate: [45, 1, 2], scale: [2, 3] },
          children: [
            {
              type: "text",
              x: 0,
              y: 10,
              content: "<b>&",
              fontSize: 12,
              fontWeight: "bold",
              textAnchor: "middle",
              fontFamily: "Inter, sans-serif",
            },
          ],
        },
        { type: "circle", cx: 1, cy: 1, r: 1, fill: { ref: "glow" } },
      ],
    })
    expect(out).toContain(
      '<linearGradient id="fade" x2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#000" stop-opacity="0.5"/></linearGradient>',
    )
    expect(out).toContain('<radialGradient id="glow" r="0.5">')
    expect(out).toContain(
      '<g id="group" fill="url(#fade)" transform="translate(10 5) rotate(45 1 2) scale(2 3)">',
    )
    expect(out).toContain(
      'font-family="Inter, sans-serif" font-weight="bold" text-anchor="middle">&lt;b&gt;&amp;</text>',
    )
    expect(out).toContain('fill="url(#glow)"')
  })
  it("produces markup the sanitizer keeps unchanged", () => {
    const out = compiled({
      ...base,
      defs: [
        {
          type: "linearGradient",
          id: "g",
          stops: [
            { offset: 0, color: "#fff" },
            { offset: 1, color: "#000" },
          ],
        },
      ],
      children: [
        {
          type: "g",
          children: [
            { type: "rect", width: 10, height: 10, fill: { ref: "g" } },
            { type: "text", x: 1, y: 1, content: "hi" },
          ],
        },
      ],
    })
    const result = sanitizeSvg(out)
    expect(result.ok && result.svg).toBe(out)
  })
})

describe("compileSvg validation", () => {
  it("requires a non-blank title", () => {
    expect(issues({ width: 1, height: 1, title: "  ", children: [] })).toContainEqual({
      path: "title",
      message: "must not be blank",
    })
  })
  it("rejects unknown keys, so no attribute can be smuggled in", () => {
    const found = issues({
      ...base,
      children: [{ type: "rect", width: 1, height: 1, onclick: "alert(1)" }],
    })
    expect(found[0]?.path).toBe("children[0]")
  })
  it("rejects unknown node types", () => {
    expect(
      issues({ ...base, children: [{ type: "script", content: "alert(1)" }] }).length,
    ).toBeGreaterThan(0)
    expect(issues({ ...base, children: [{ type: "foreignObject" }] }).length).toBeGreaterThan(0)
  })
  it("rejects non-hex paint so url() and expressions cannot appear", () => {
    for (const fill of ["url(https://x.example/#g)", "red", "javascript:alert(1)", "#12345"]) {
      expect(
        issues({ ...base, children: [{ type: "rect", width: 1, height: 1, fill }] })[0]?.path,
      ).toBe("children[0].fill")
    }
  })
  it("rejects path data outside the command alphabet", () => {
    expect(issues({ ...base, children: [{ type: "path", d: 'M0 0"/><script>' }] })[0]?.path).toBe(
      "children[0].d",
    )
    expect(issues({ ...base, children: [{ type: "path", d: "L0 0" }] })[0]?.path).toBe(
      "children[0].d",
    )
  })
  it("rejects unsafe font families", () => {
    expect(
      issues({
        ...base,
        children: [{ type: "text", x: 0, y: 0, content: "x", fontFamily: "a;}</style>" }],
      })[0]?.path,
    ).toBe("children[0].fontFamily")
  })
  it("rejects out-of-range and non-finite numbers", () => {
    expect(
      issues({
        ...base,
        children: [{ type: "circle", cx: DSL_MAX_COORDINATE + 1, cy: 0, r: 1 }],
      })[0]?.path,
    ).toBe("children[0].cx")
    expect(
      issues({ ...base, children: [{ type: "circle", cx: Number.NaN, cy: 0, r: 1 }] })[0]?.path,
    ).toBe("children[0].cx")
    expect(issues({ ...base, children: [{ type: "rect", width: -1, height: 1 }] })[0]?.path).toBe(
      "children[0].width",
    )
    expect(issues({ ...base, width: 0, children: [] })[0]?.path).toBe("width")
  })
  it("requires at least two gradient stops with offsets in [0, 1]", () => {
    expect(
      issues({
        ...base,
        defs: [{ type: "linearGradient", id: "g", stops: [{ offset: 0, color: "#fff" }] }],
        children: [],
      })[0]?.path,
    ).toBe("defs[0].stops")
    expect(
      issues({
        ...base,
        defs: [
          {
            type: "linearGradient",
            id: "g",
            stops: [
              { offset: 0, color: "#fff" },
              { offset: 2, color: "#000" },
            ],
          },
        ],
        children: [],
      })[0]?.path,
    ).toBe("defs[0].stops[1].offset")
  })
  it("rejects references to undeclared gradients", () => {
    expect(
      issues({
        ...base,
        children: [
          { type: "g", children: [{ type: "rect", width: 1, height: 1, stroke: { ref: "nope" } }] },
        ],
      }),
    ).toEqual([
      { path: "children[0].children[0].stroke", message: 'references unknown gradient "nope"' },
    ])
  })
  it("rejects duplicate and invalid ids", () => {
    const dupes = issues({
      ...base,
      defs: [
        {
          type: "linearGradient",
          id: "a",
          stops: [
            { offset: 0, color: "#fff" },
            { offset: 1, color: "#000" },
          ],
        },
      ],
      children: [{ type: "rect", id: "a", width: 1, height: 1 }],
    })
    expect(dupes).toEqual([{ path: "children[0].id", message: 'duplicate id "a"' }])
    expect(
      issues({ ...base, children: [{ type: "rect", id: "1 bad", width: 1, height: 1 }] })[0]?.path,
    ).toBe("children[0].id")
  })
  it("bounds nesting depth and object count before parsing", () => {
    let node: Record<string, unknown> = { type: "rect", width: 1, height: 1 }
    for (let i = 0; i < 5000; i += 1) node = { type: "g", children: [node] }
    expect(() => compileSvg({ ...base, children: [node] })).not.toThrow()
    expect(issues({ ...base, children: [node] })[0]?.message).toMatch(/nested deeper/)
    const many = Array.from({ length: 50 }, () => ({ type: "circle", cx: 0, cy: 0, r: 1 }))
    expect(compileSvg({ ...base, children: many }, { maxNodes: 20 }).ok).toBe(false)
  })
  it("enforces the group depth limit exactly", () => {
    const nest = (depth: number): unknown =>
      depth === 0
        ? { type: "rect", width: 1, height: 1 }
        : { type: "g", children: [nest(depth - 1)] }
    expect(compileSvg({ ...base, children: [nest(3)] }, { maxDepth: 4 }).ok).toBe(true)
    expect(compileSvg({ ...base, children: [nest(4)] }, { maxDepth: 4 }).ok).toBe(false)
  })
  it("never throws on garbage input", () => {
    for (const input of [null, undefined, 42, "svg", [], { width: "1" }]) {
      expect(() => compileSvg(input)).not.toThrow()
      expect(compileSvg(input).ok).toBe(false)
    }
  })
})

describe("parseSvgDocument and renderSvgDocument", () => {
  it("separate validation from rendering", () => {
    const parsed = parseSvgDocument({ ...base, children: [{ type: "circle", cx: 1, cy: 1, r: 1 }] })
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      const doc: SvgDocument = parsed.value
      expect(renderSvgDocument(doc)).toContain('<circle cx="1" cy="1" r="1"/>')
    }
  })
})
