import { describe, expect, it } from "vitest"
import {
  contrastRatio,
  flatten,
  formatOklch,
  formatRgb,
  isInSrgbGamut,
  meetsContrast,
  minimumContrast,
  oklchToRgb,
  parseColor,
  parseHex,
  parseOklch,
  pickReadableText,
  relativeLuminance,
  rgb,
  rgbToOklch,
  toHex,
} from "../src/color.ts"

describe("hex and rgb", () => {
  it("parses short, long and alpha hex", () => {
    expect(parseHex("#fff")).toEqual({ r: 255, g: 255, b: 255, alpha: 1 })
    expect(parseHex("#336699")).toEqual({ r: 51, g: 102, b: 153, alpha: 1 })
    expect(parseHex("#00000080")?.alpha).toBeCloseTo(128 / 255)
  })
  it("rejects invalid hex", () => {
    for (const bad of ["fff", "#ff", "#ggg", "#12345", "red"]) expect(parseHex(bad)).toBeNull()
  })
  it("round-trips through toHex", () => {
    for (const hex of ["#000000", "#ffffff", "#3366cc", "#0a0b0c"]) {
      const color = parseHex(hex)
      expect(color && toHex(color)).toBe(hex)
    }
  })
  it("clamps rgb components", () => {
    expect(rgb(300, -5, 10, 2)).toEqual({ r: 255, g: 0, b: 10, alpha: 1 })
  })
  it("formats rgb()", () => {
    expect(formatRgb(rgb(1, 2, 3))).toBe("rgb(1 2 3)")
    expect(formatRgb(rgb(1, 2, 3, 0.5))).toBe("rgb(1 2 3 / 0.5)")
  })
  it("parses css color functions", () => {
    expect(parseColor("rgb(255, 0, 0)")).toEqual({ r: 255, g: 0, b: 0, alpha: 1 })
    expect(parseColor("rgba(0 0 255 / 50%)")?.alpha).toBeCloseTo(0.5)
    expect(
      parseColor("oklch(100% 0 0)") && toHex(parseColor("oklch(100% 0 0)") ?? rgb(0, 0, 0)),
    ).toBe("#ffffff")
    expect(parseColor("blue")).toBeNull()
  })
})

describe("OKLCH", () => {
  it("converts known reference colors", () => {
    const white = rgbToOklch(rgb(255, 255, 255))
    expect(white.l).toBeCloseTo(1, 3)
    expect(white.c).toBeCloseTo(0, 3)
    const red = rgbToOklch(rgb(255, 0, 0))
    expect(red.l).toBeCloseTo(0.628, 2)
    expect(red.c).toBeCloseTo(0.2577, 2)
    expect(red.h).toBeCloseTo(29.23, 0)
  })
  it("round-trips sRGB colors", () => {
    for (const hex of ["#3366cc", "#ff8800", "#123456", "#808080"]) {
      const color = parseHex(hex)
      expect(color && toHex(oklchToRgb(rgbToOklch(color)))).toBe(hex)
    }
  })
  it("parses and formats oklch()", () => {
    const parsed = parseOklch("oklch(53.25% 0.1679 262.29)")
    expect(parsed?.l).toBeCloseTo(0.5325)
    expect(parsed && formatOklch(parsed)).toBe("oklch(53.25% 0.1679 262.29)")
    expect(parseOklch("oklch(0.5 0.1 20 / 0.5)")?.alpha).toBe(0.5)
    expect(parseOklch("oklch(nope)")).toBeNull()
  })
  it("gamut-maps out-of-range colors by reducing chroma", () => {
    const vivid = { l: 0.7, c: 0.4, h: 150, alpha: 1 }
    expect(isInSrgbGamut(vivid)).toBe(false)
    const mapped = oklchToRgb(vivid)
    for (const channel of [mapped.r, mapped.g, mapped.b]) {
      expect(channel).toBeGreaterThanOrEqual(0)
      expect(channel).toBeLessThanOrEqual(255)
    }
    expect(rgbToOklch(mapped).l).toBeCloseTo(0.7, 1)
  })
})

describe("WCAG contrast", () => {
  it("matches the reference extremes", () => {
    expect(contrastRatio("#000", "#fff")).toBeCloseTo(21, 5)
    expect(contrastRatio("#fff", "#fff")).toBeCloseTo(1, 5)
    expect(relativeLuminance(rgb(255, 255, 255))).toBeCloseTo(1)
  })
  it("matches a known mid-grey value", () => {
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 2)
  })
  it("is symmetric", () => {
    expect(contrastRatio("#2563eb", "#f8fafc")).toBeCloseTo(contrastRatio("#f8fafc", "#2563eb"))
  })
  it("flattens translucent colors over the background", () => {
    expect(flatten(rgb(0, 0, 0, 0.5), rgb(255, 255, 255))).toEqual(rgb(127.5, 127.5, 127.5))
    expect(contrastRatio("#00000000", "#ffffff")).toBeCloseTo(1)
  })
  it("applies AA and AAA thresholds", () => {
    expect(minimumContrast("AA")).toBe(4.5)
    expect(minimumContrast("AA", true)).toBe(3)
    expect(minimumContrast("AAA")).toBe(7)
    expect(meetsContrast("#777777", "#ffffff")).toBe(false)
    expect(meetsContrast("#777777", "#ffffff", "AA", true)).toBe(true)
  })
  it("throws on unparseable colors", () => {
    expect(() => contrastRatio("nope", "#fff")).toThrow(TypeError)
  })
})

describe("pickReadableText", () => {
  it("picks white on dark and near-black on light backgrounds", () => {
    expect(pickReadableText("#2563eb")).toBe("#ffffff")
    expect(pickReadableText("#facc15")).toBe("#111111")
  })
  it("uses custom candidates and needs at least one", () => {
    expect(pickReadableText("#000", ["#333333", "#eeeeee"])).toBe("#eeeeee")
    expect(() => pickReadableText("#000", [])).toThrow(RangeError)
  })
})
