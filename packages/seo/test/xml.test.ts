import { describe, expect, it } from "vitest"
import { cdata, escapeXml, stripInvalidXmlChars } from "../src/xml.ts"

describe("xml", () => {
  it("escapes the five special characters", () => {
    expect(escapeXml(`Q&A <"x"> 'y'`)).toBe("Q&amp;A &lt;&quot;x&quot;&gt; &apos;y&apos;")
  })

  it("strips control characters and lone surrogates but keeps tab/newline and pairs", () => {
    expect(stripInvalidXmlChars("a\u0007b\tc\nd")).toBe("ab\tc\nd")
    expect(stripInvalidXmlChars("x\uD800y\uDC00z")).toBe("xyz")
    expect(stripInvalidXmlChars("😀")).toBe("😀")
  })

  it("splits ]]> inside CDATA", () => {
    expect(cdata("a]]>b")).toBe("<![CDATA[a]]]]><![CDATA[>b]]>")
  })
})
