import { describe, expect, it } from "vitest"
import {
  DEFAULT_FALLBACK,
  formatBytes,
  formatCompact,
  formatCount,
  formatDuration,
  formatNumber,
  formatPercent,
} from "../src/format.ts"

describe("formatNumber", () => {
  it("groups and limits fraction digits", () => {
    expect(formatNumber(1234.5)).toBe("1,234.5")
    expect(formatNumber(1.23456)).toBe("1.235")
    expect(formatNumber(1234.5, { locale: "de-DE" })).toBe("1.234,5")
    expect(formatNumber(2, { digits: 2 })).toBe("2.00")
  })
  it("uses the fallback for non-finite input", () => {
    expect(formatNumber(Number.NaN)).toBe(DEFAULT_FALLBACK)
    expect(formatNumber(Number.POSITIVE_INFINITY, { fallback: "n/a" })).toBe("n/a")
  })
})

describe("formatCompact", () => {
  it("abbreviates", () => {
    expect(formatCompact(1_250_000)).toBe("1.3M")
    expect(formatCompact(999)).toBe("999")
    expect(formatCompact(Number.NaN)).toBe(DEFAULT_FALLBACK)
  })
})

describe("formatPercent", () => {
  it("formats fractions", () => {
    expect(formatPercent(0.4271)).toBe("42.7%")
    expect(formatPercent(0.5)).toBe("50%")
    expect(formatPercent(0.5, { digits: 2 })).toBe("50.00%")
    expect(formatPercent(0.032, { signed: true })).toBe("+3.2%")
    expect(formatPercent(-0.032, { signed: true })).toBe("-3.2%")
    expect(formatPercent(0, { signed: true })).toBe("0%")
    expect(formatPercent(Number.NaN)).toBe(DEFAULT_FALLBACK)
  })
})

describe("formatCount", () => {
  it("pluralizes", () => {
    expect(formatCount(1, "invoice")).toBe("1 invoice")
    expect(formatCount(0, "invoice")).toBe("0 invoices")
    expect(formatCount(1204, "person")).toBe("1,204 people")
    expect(formatCount(2, "cactus", { plural: "cacti" })).toBe("2 cacti")
  })
})

describe("formatDuration", () => {
  it("renders compound durations", () => {
    expect(formatDuration(90_061_000)).toBe("1d 1h 1m 1s")
    expect(formatDuration(5_400_000)).toBe("1h 30m")
    expect(formatDuration(93_784_000, { largest: 2 })).toBe("1d 2h")
    expect(formatDuration(350)).toBe("350ms")
    expect(formatDuration(0)).toBe("0ms")
    expect(formatDuration(-61_000)).toBe("-1m 1s")
    expect(formatDuration(Number.NaN)).toBe(DEFAULT_FALLBACK)
  })
})

describe("formatBytes", () => {
  it("uses decimal units by default and binary on request", () => {
    expect(formatBytes(0)).toBe("0 B")
    expect(formatBytes(999)).toBe("999 B")
    expect(formatBytes(1536)).toBe("1.5 KB")
    expect(formatBytes(1_500_000)).toBe("1.5 MB")
    expect(formatBytes(1_048_576, { binary: true })).toBe("1 MiB")
    expect(formatBytes(-2048, { binary: true })).toBe("-2 KiB")
    expect(formatBytes(Number.NaN)).toBe(DEFAULT_FALLBACK)
  })
})
