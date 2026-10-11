import { describe, expect, it } from "vitest"
import { fragment, h, isMarkup, Markup, raw, SVG_NS, svg } from "../src/element.ts"

describe("h", () => {
  it("builds nested markup without double-escaping", () => {
    expect(
      h("g", { fill: "#111" }, h("rect", { width: 4, height: 4 }), h("text", {}, "a < b")).value,
    ).toBe('<g fill="#111"><rect width="4" height="4"/><text>a &lt; b</text></g>')
  })
  it("escapes attribute values", () => {
    expect(h("text", { "aria-label": '"><script>' }).value).toBe(
      '<text aria-label="&quot;&gt;&lt;script&gt;"/>',
    )
  })
  it("omits null, undefined and false attributes and children", () => {
    expect(h("g", { a: null, b: undefined, c: false, d: 0 }, null, false, undefined).value).toBe(
      '<g d="0"/>',
    )
  })
  it("flattens nested child arrays", () => {
    expect(h("g", {}, ["a", ["b", 1]]).value).toBe("<g>ab1</g>")
  })
  it("refuses event handler attributes", () => {
    expect(() => h("rect", { onclick: "x()" })).toThrow(TypeError)
    expect(() => h("rect", { ONLOAD: "x()" })).toThrow(TypeError)
  })
  it("refuses invalid names", () => {
    expect(() => h("rect onload", {})).toThrow(TypeError)
    expect(() => h("rect", { 'x"': "1" })).toThrow(TypeError)
  })
  it("refuses non-finite numbers", () => {
    expect(() => h("rect", { width: Number.NaN })).toThrow(RangeError)
  })
})

describe("raw, fragment, svg", () => {
  it("inserts raw markup verbatim", () => {
    expect(h("g", {}, raw("<b/>")).value).toBe("<g><b/></g>")
    expect(isMarkup(raw("x"))).toBe(true)
    expect(isMarkup("x")).toBe(false)
    expect(String(new Markup("<x/>"))).toBe("<x/>")
  })
  it("concatenates a fragment", () => {
    expect(fragment(h("a"), "<", h("b")).value).toBe("<a/>&lt;<b/>")
  })
  it("adds the SVG namespace", () => {
    expect(svg({ width: 1 }).value).toBe(`<svg xmlns="${SVG_NS}" width="1"/>`)
  })
})
