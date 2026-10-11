import { describe, expect, it } from "vitest"
import {
  escapeXmlAttr,
  escapeXmlText,
  formatNumber,
  isXmlName,
  stripIllegalXmlChars,
} from "../src/escape.ts"

describe("escapeXmlText", () => {
  it("escapes markup characters", () => {
    expect(escapeXmlText(`a < b & "c" 'd' >`)).toBe("a &lt; b &amp; &quot;c&quot; &#39;d&#39; &gt;")
  })
  it("drops characters XML 1.0 cannot represent", () => {
    expect(escapeXmlText("a\u0000b\u0008c\uFFFEd")).toBe("abcd")
  })
})

describe("escapeXmlAttr", () => {
  it("encodes whitespace so attribute normalization cannot change the value", () => {
    expect(escapeXmlAttr('x"y\n\t\r<z>')).toBe("x&quot;y&#10;&#9;&#13;&lt;z&gt;")
  })
  it("cannot break out of a double-quoted attribute", () => {
    expect(escapeXmlAttr('" onload="alert(1)')).not.toContain('"')
  })
})

describe("stripIllegalXmlChars", () => {
  it("keeps tab, newline and astral characters", () => {
    expect(stripIllegalXmlChars("a\tb\nc😀\u0001")).toBe("a\tb\nc😀")
  })
  it("drops lone surrogates", () => {
    expect(stripIllegalXmlChars("a\uD800b")).toBe("ab")
  })
})

describe("isXmlName", () => {
  it.each(["svg", "xlink:href", "stroke-width", "_x", "a.b"])("accepts %s", (name) => {
    expect(isXmlName(name)).toBe(true)
  })
  it.each(["", "1a", "a b", "a>", "-x", 'a"'])("rejects %j", (name) => {
    expect(isXmlName(name)).toBe(false)
  })
})

describe("formatNumber", () => {
  it("rounds and trims", () => {
    expect(formatNumber(1.23456)).toBe("1.235")
    expect(formatNumber(2.5)).toBe("2.5")
    expect(formatNumber(10)).toBe("10")
    expect(formatNumber(1.23456, 1)).toBe("1.2")
  })
  it("normalizes negative zero", () => {
    expect(formatNumber(-0)).toBe("0")
    expect(formatNumber(-0.0001)).toBe("0")
  })
  it("throws on non-finite input", () => {
    expect(() => formatNumber(Number.NaN)).toThrow(RangeError)
    expect(() => formatNumber(Number.POSITIVE_INFINITY)).toThrow(RangeError)
  })
})
