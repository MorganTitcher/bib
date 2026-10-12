import { describe, expect, it } from "vitest"
import { formatNumber, isXmlName } from "../src/escape.ts"

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
