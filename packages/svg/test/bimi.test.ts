import { describe, expect, it } from "vitest"
import { BIMI_MAX_BYTES, type BimiViolationCode, checkBimiSvg } from "../src/bimi.ts"

const ROOT =
  'xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny-ps" viewBox="0 0 100 100"'
const GOOD = `<svg ${ROOT}><title>Example Co</title><rect width="100" height="100" fill="#ffffff"/><circle cx="50" cy="50" r="30" fill="#1d4ed8"/></svg>`

function codes(input: string): BimiViolationCode[] {
  return checkBimiSvg(input).violations.map((v) => v.code)
}

function withRoot(
  attrs: string,
  body = '<title>T</title><rect width="100" height="100" fill="#fff"/>',
): string {
  return `<svg ${attrs}>${body}</svg>`
}

describe("checkBimiSvg", () => {
  it("accepts a conforming logo", () => {
    expect(checkBimiSvg(GOOD)).toEqual({ ok: true, violations: [] })
  })
  it("accepts equal absolute px width and height of at least 96", () => {
    expect(codes(withRoot(`${ROOT} width="96px" height="96px"`))).toEqual([])
  })

  it.each<[string, string, BimiViolationCode]>([
    [
      "missing version",
      'xmlns="http://www.w3.org/2000/svg" baseProfile="tiny-ps" viewBox="0 0 100 100"',
      "version",
    ],
    [
      "wrong profile",
      'xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" viewBox="0 0 100 100"',
      "base-profile",
    ],
    ["missing namespace", 'version="1.2" baseProfile="tiny-ps" viewBox="0 0 100 100"', "namespace"],
    [
      "non-square viewBox",
      'xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny-ps" viewBox="0 0 100 50"',
      "viewbox",
    ],
    [
      "missing viewBox",
      'xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny-ps"',
      "viewbox",
    ],
    ["root x/y", `${ROOT} x="10" y="0"`, "root-position"],
    ["relative size", `${ROOT} width="100%" height="100%"`, "dimensions"],
    ["too small", `${ROOT} width="32" height="32"`, "dimensions"],
    ["unequal size", `${ROOT} width="100" height="120"`, "dimensions"],
  ])("flags %s", (_label, attrs, code) => {
    const report = checkBimiSvg(withRoot(attrs))
    expect(report.ok).toBe(false)
    expect(report.violations.map((v) => v.code)).toContain(code)
  })

  it.each<[string, string, BimiViolationCode]>([
    ["missing title", '<rect width="100" height="100" fill="#fff"/>', "title"],
    ["empty title", '<title> </title><rect width="100" height="100" fill="#fff"/>', "title"],
    ["title not first", '<rect width="100" height="100" fill="#fff"/><title>T</title>', "title"],
    ["script", "<title>T</title><script>alert(1)</script>", "forbidden-element"],
    [
      "image",
      '<title>T</title><image href="data:image/png;base64,AAAA" width="1" height="1"/>',
      "forbidden-element",
    ],
    [
      "animation",
      '<title>T</title><rect width="100" height="100"><animate attributeName="x" to="1"/></rect>',
      "forbidden-element",
    ],
    ["foreignObject", "<title>T</title><foreignObject/>", "forbidden-element"],
    ["nested svg", "<title>T</title><svg/>", "forbidden-element"],
    ["unknown element", "<title>T</title><blink/>", "unknown-element"],
    [
      "event handler",
      '<title>T</title><rect width="100" height="100" onclick="x()"/>',
      "event-handler",
    ],
    [
      "inline style",
      '<title>T</title><rect width="100" height="100" style="fill:red"/>',
      "inline-style",
    ],
    ["xml:base", '<title>T</title><g xml:base="https://x.example/"/>', "xml-base"],
    [
      "external href",
      '<title>T</title><use href="https://x.example/a.svg#b"/>',
      "external-reference",
    ],
    [
      "external url()",
      '<title>T</title><rect width="100" height="100" fill="url(https://x.example/#g)"/>',
      "external-reference",
    ],
  ])("flags %s", (_label, body, code) => {
    expect(codes(withRoot(ROOT, body))).toContain(code)
  })

  it("rejects DOCTYPE, stylesheet PIs, malformed XML and a wrong root", () => {
    expect(codes(`<!DOCTYPE svg><svg ${ROOT}/>`)).toContain("dtd")
    expect(codes(`<?xml-stylesheet href="a.css"?>${GOOD}`)).toContain("stylesheet-pi")
    expect(codes(`<svg ${ROOT}><g></svg>`)).toContain("malformed")
    expect(codes("<html/>")).toContain("root")
  })
  it("rejects files over the size limit", () => {
    const padding = `<desc>${"x".repeat(BIMI_MAX_BYTES)}</desc>`
    expect(codes(withRoot(ROOT, `<title>T</title>${padding}`))).toContain("too-large")
  })
  it("allows local references and metadata", () => {
    const body =
      '<title>T</title><desc>Logo</desc><defs><linearGradient id="g"><stop offset="0" stop-color="#000"/></linearGradient></defs>' +
      '<rect width="100" height="100" fill="#fff"/><rect width="100" height="100" fill="url(#g)"/>'
    expect(codes(withRoot(ROOT, body))).toEqual([])
  })
  it("warns, without failing, when there is no opaque full-size background", () => {
    const report = checkBimiSvg(
      withRoot(ROOT, '<title>T</title><circle cx="50" cy="50" r="30" fill="#000"/>'),
    )
    expect(report.ok).toBe(true)
    expect(report.violations).toEqual([
      expect.objectContaining({ code: "no-opaque-background", severity: "warning" }),
    ])
  })
})
