import { describe, expect, it } from "vitest"
import { cdata, escapeXml, escapeXmlAttr, isXmlChar, stripInvalidXmlChars } from "../src/xml.ts"

describe("isXmlChar", () => {
  it.each([0x9, 0xa, 0xd, 0x20, 0xd7ff, 0xe000, 0xfffd, 0x10000, 0x10ffff])("accepts %i", (cp) => {
    expect(isXmlChar(cp)).toBe(true)
  })
  it.each([0x0, 0x8, 0xb, 0x1f, 0xd800, 0xdfff, 0xfffe, 0xffff, 0x110000])("rejects %i", (cp) => {
    expect(isXmlChar(cp)).toBe(false)
  })
})

describe("stripInvalidXmlChars", () => {
  it("keeps tab, newline and astral characters", () => {
    expect(stripInvalidXmlChars("a\tb\nc😀\u0001")).toBe("a\tb\nc😀")
    expect(stripInvalidXmlChars("a\u0007b\tc\nd")).toBe("ab\tc\nd")
  })
  it("drops lone surrogates of either half", () => {
    expect(stripInvalidXmlChars("x\uD800y\uDC00z")).toBe("xyz")
  })
  it("drops U+FFFE and U+FFFF", () => {
    expect(stripInvalidXmlChars("a￾b￿c")).toBe("abc")
  })
})

describe("escapeXml", () => {
  it("escapes the five special characters", () => {
    expect(escapeXml(`Q&A <"x"> 'y'`)).toBe("Q&amp;A &lt;&quot;x&quot;&gt; &#39;y&#39;")
  })
  it("drops characters XML 1.0 cannot represent", () => {
    expect(escapeXml("a\u0000b\u0008c￾d")).toBe("abcd")
  })
  it("leaves whitespace literal", () => {
    expect(escapeXml("a\nb")).toBe("a\nb")
  })
})

describe("escapeXmlAttr", () => {
  it("encodes whitespace so attribute normalization cannot change the value", () => {
    expect(escapeXmlAttr('x"y\n\t\r<z>')).toBe("x&quot;y&#10;&#9;&#13;&lt;z&gt;")
  })
  it("cannot break out of a quoted attribute", () => {
    expect(escapeXmlAttr(`" onload="alert(1)' x='`)).not.toMatch(/["']/)
  })
})

describe("cdata", () => {
  it("splits ]]> inside CDATA", () => {
    expect(cdata("a]]>b")).toBe("<![CDATA[a]]]]><![CDATA[>b]]>")
  })
  it("strips invalid characters", () => {
    expect(cdata("a\u0001b")).toBe("<![CDATA[ab]]>")
  })
})
