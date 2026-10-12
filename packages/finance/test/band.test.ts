import { createRng } from "@bib/shared/random"
import { describe, expect, it } from "vitest"
import {
  band,
  bandSchema,
  bpsBand,
  clampToLimits,
  isBand,
  isUncertain,
  rateBand,
  sampleBand,
  withPoint,
} from "../src/band.ts"

describe("bandSchema", () => {
  it("turns a bare number into a zero-width band", () => {
    expect(bandSchema().parse(5)).toEqual({ low: 5, point: 5, high: 5 })
  })

  it("keeps provenance and records limits", () => {
    const out = rateBand().parse({
      low: 0.02,
      point: 0.03,
      high: 0.05,
      provenance: { source: "billing export", evidence: "observed" },
    })
    expect(out).toEqual({
      low: 0.02,
      point: 0.03,
      high: 0.05,
      min: 0,
      max: 1,
      provenance: { source: "billing export", evidence: "observed" },
    })
  })

  it("rejects out-of-order, non-finite and out-of-limit bands", () => {
    expect(bandSchema().safeParse({ low: 3, point: 2, high: 4 }).success).toBe(false)
    expect(bandSchema().safeParse(Number.NaN).success).toBe(false)
    expect(rateBand().safeParse(1.2).success).toBe(false)
    expect(bpsBand().safeParse(-1).success).toBe(false)
  })

  it("rejects an unknown evidence level", () => {
    const bad = { low: 1, point: 2, high: 3, provenance: { source: "x", evidence: "rumor" } }
    expect(bandSchema().safeParse(bad).success).toBe(false)
  })
})

describe("band helpers", () => {
  it("builds bands in code and checks order", () => {
    expect(band(49)).toEqual({ low: 49, point: 49, high: 49 })
    expect(band(39, 49, 59).high).toBe(59)
    expect(() => band(5, 4, 6)).toThrow(RangeError)
  })

  it("clamps to hard limits and widens the range when moving the point", () => {
    const rate = rateBand().parse({ low: 0.8, point: 0.9, high: 0.95 })
    expect(clampToLimits(rate, 1.3)).toBe(1)
    expect(withPoint(rate, 1.3)).toMatchObject({ low: 0.8, point: 1, high: 1 })
    expect(withPoint(rate, 0.5)).toMatchObject({ low: 0.5, point: 0.5, high: 0.95 })
  })

  it("samples inside the band and skips randomness for a fixed band", () => {
    const rng = createRng(7)
    const b = band(10, 20, 40)
    for (let i = 0; i < 200; i++) {
      const v = sampleBand(b, rng)
      expect(v).toBeGreaterThanOrEqual(10)
      expect(v).toBeLessThanOrEqual(40)
    }
    expect(sampleBand(band(3), rng)).toBe(3)
  })

  it("recognizes bands and uncertainty", () => {
    expect(isBand({ low: 1, point: 1, high: 1 })).toBe(true)
    expect(isBand({ low: 1, point: "1", high: 1 })).toBe(false)
    expect(isBand(null)).toBe(false)
    expect(isUncertain(band(1))).toBe(false)
    expect(isUncertain(band(1, 2, 3))).toBe(true)
  })
})
