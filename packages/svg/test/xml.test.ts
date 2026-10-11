import { describe, expect, it } from "vitest"
import { elementsOf, getAttr, parseXml, type XmlElement } from "../src/xml.ts"

function root(input: string): XmlElement {
  const result = parseXml(input)
  if (!result.ok) throw new Error(result.error.message)
  const [el] = elementsOf(result.nodes)
  if (!el) throw new Error("no root")
  return el
}

describe("parseXml", () => {
  it("parses elements, attributes, text and references", () => {
    const el = root("<a x=\"1 &amp; 2\" y='&#x41;'><b>t&lt;</b><![CDATA[<raw>]]></a>")
    expect(el.name).toBe("a")
    expect(getAttr(el, "x")).toBe("1 & 2")
    expect(getAttr(el, "y")).toBe("A")
    const [b] = elementsOf(el.children)
    expect(b?.name).toBe("b")
    expect(b?.children[0]).toMatchObject({ type: "text", value: "t<" })
    expect(el.children[1]).toMatchObject({ type: "cdata", value: "<raw>" })
  })
  it("normalizes literal whitespace in attribute values but keeps encoded whitespace", () => {
    const el = root('<a v="a\tb\nc" w="a&#10;b"/>')
    expect(getAttr(el, "v")).toBe("a b c")
    expect(getAttr(el, "w")).toBe("a\nb")
  })
  it("returns every top-level node; root uniqueness is the caller's policy", () => {
    const result = parseXml("<a/><b/>")
    expect(result.ok && elementsOf(result.nodes).map((el) => el.name)).toEqual(["a", "b"])
    expect(parseXml("")).toEqual({ ok: true, nodes: [] })
  })
  it("accepts an XML declaration and surrounding comments", () => {
    expect(root('<?xml version="1.0"?><!-- c --><a/><!-- d -->').name).toBe("a")
  })

  it.each([
    ["unknown entity", "<a>&nbsp;</a>"],
    ["unquoted attribute", "<a x=1/>"],
    ["duplicate attribute", '<a x="1" x="2"/>'],
    ["< in attribute", '<a x="<"/>'],
    ["mismatched tag", "<a><b></a></b>"],
    ["unclosed tag", "<a><b>"],
    ["text after root", "<a/>junk"],
    ["double dash in comment", "<a><!-- x -- y --></a>"],
    ["]]> in text", "<a>]]></a>"],
  ])("rejects %s as malformed", (_label, input) => {
    const result = parseXml(input)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe("malformed")
  })

  it("rejects DOCTYPE and ENTITY declarations with their own code", () => {
    const result = parseXml('<!DOCTYPE a [<!ENTITY x "y">]><a>&x;</a>')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe("declaration")
  })

  it("enforces depth and node limits without recursion", () => {
    const deep = `${"<g>".repeat(5000)}${"</g>".repeat(5000)}`
    const tooDeep = parseXml(deep, { maxDepth: 100 })
    expect(tooDeep.ok).toBe(false)
    if (!tooDeep.ok) expect(tooDeep.error.code).toBe("too-deep")
    const many = parseXml(`<a>${"<b/>".repeat(50)}</a>`, { maxNodes: 10 })
    expect(many.ok).toBe(false)
    if (!many.ok) expect(many.error.code).toBe("too-many-nodes")
  })

  it("never throws on hostile input", () => {
    for (const input of [
      "<",
      "<<<",
      "<a",
      '<a b="',
      "<!--",
      "<![CDATA[",
      "<?",
      "&",
      "<a>&#xFFFFFFFF;</a>",
      "<a>&#0;</a>",
    ]) {
      expect(() => parseXml(input)).not.toThrow()
      expect(parseXml(input).ok).toBe(false)
    }
  })
})
