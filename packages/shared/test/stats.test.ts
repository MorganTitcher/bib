import { describe, expect, it } from "vitest"
import {
  erf,
  erfc,
  histogram,
  logGamma,
  mean,
  median,
  normalCdf,
  percentile,
  quantiles,
  regularizedIncompleteBeta,
  sampleStdev,
  sampleVariance,
  stdev,
  studentTCdf,
  sum,
  twoProportionZTest,
  variance,
  welchTTest,
} from "../src/stats.ts"

describe("descriptive statistics", () => {
  it("sums with compensation", () => {
    expect(sum([])).toBe(0)
    expect(sum([0.1, 0.2, 0.3])).toBe(0.6)
    expect(sum([1e16, 1, -1e16])).toBe(1)
  })
  it("computes centre and spread", () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5)
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 3, 2])).toBe(2.5)
    expect(variance([2, 4, 4, 4, 5, 5, 7, 9])).toBe(4)
    expect(stdev([2, 4, 4, 4, 5, 5, 7, 9])).toBe(2)
    expect(sampleVariance([1, 2, 3, 4])).toBeCloseTo(1.6667, 4)
    expect(sampleStdev([1, 2, 3, 4])).toBeCloseTo(1.291, 3)
  })
  it("interpolates percentiles", () => {
    expect(percentile([10, 20, 30, 40, 50], 90)).toBe(46)
    expect(percentile([10, 20, 30, 40, 50], 0)).toBe(10)
    expect(percentile([10, 20, 30, 40, 50], 100)).toBe(50)
    expect(percentile([7], 50)).toBe(7)
    expect(quantiles([1, 2, 3, 4, 5])).toEqual([2, 3, 4])
    expect(() => percentile([1], 101)).toThrow(RangeError)
    expect(() => quantiles([1, 2], 1)).toThrow(RangeError)
  })
  it("throws on empty or too-small input", () => {
    expect(() => mean([])).toThrow(RangeError)
    expect(() => median([])).toThrow(RangeError)
    expect(() => sampleVariance([1])).toThrow(RangeError)
  })
  it("does not mutate input", () => {
    const xs = [3, 1, 2]
    median(xs)
    percentile(xs, 50)
    expect(xs).toEqual([3, 1, 2])
  })
})

describe("histogram", () => {
  it("bins data", () => {
    expect(histogram([1, 2, 2, 3, 9], { bins: 2 })).toEqual([
      { start: 1, end: 5, count: 4 },
      { start: 5, end: 9, count: 1 },
    ])
  })
  it("ignores non-finite and out-of-range values", () => {
    const h = histogram([Number.NaN, -1, 0, 5, 10, 11], { bins: 2, min: 0, max: 10 })
    expect(h.map((b) => b.count)).toEqual([1, 2])
  })
  it("handles degenerate input", () => {
    expect(histogram([])).toEqual([])
    expect(histogram([5, 5, 5], { bins: 3 }).reduce((n, b) => n + b.count, 0)).toBe(3)
    expect(() => histogram([1], { bins: 0 })).toThrow(RangeError)
  })
})

describe("special functions", () => {
  it("match known values", () => {
    expect(logGamma(5)).toBeCloseTo(Math.log(24), 10)
    expect(logGamma(0.5)).toBeCloseTo(Math.log(Math.sqrt(Math.PI)), 10)
    expect(erf(0)).toBeCloseTo(0, 12)
    expect(erf(1)).toBeCloseTo(0.8427007929, 8)
    expect(erfc(1)).toBeCloseTo(0.1572992071, 8)
    expect(normalCdf(0)).toBeCloseTo(0.5, 12)
    expect(normalCdf(1.959964)).toBeCloseTo(0.975, 6)
    expect(normalCdf(110, 100, 10)).toBeCloseTo(0.8413447, 6)
    expect(regularizedIncompleteBeta(0.5, 2, 2)).toBeCloseTo(0.5, 10)
    expect(regularizedIncompleteBeta(0, 2, 3)).toBe(0)
    expect(regularizedIncompleteBeta(1, 2, 3)).toBe(1)
    expect(studentTCdf(0, 5)).toBeCloseTo(0.5, 10)
    expect(studentTCdf(2.570582, 5)).toBeCloseTo(0.975, 5)
  })
})

describe("twoProportionZTest", () => {
  it("matches a hand-computed example", () => {
    const r = twoProportionZTest({ successes: 120, trials: 1000 }, { successes: 150, trials: 1000 })
    expect(r.rateA).toBe(0.12)
    expect(r.difference).toBeCloseTo(0.03, 12)
    expect(r.z).toBeCloseTo(1.963, 3)
    expect(r.pValue).toBeCloseTo(0.0497, 3)
  })
  it("handles zero variance", () => {
    expect(twoProportionZTest({ successes: 0, trials: 10 }, { successes: 0, trials: 10 })).toEqual({
      rateA: 0,
      rateB: 0,
      difference: 0,
      z: 0,
      pValue: 1,
    })
  })
  it("validates arms", () => {
    expect(() =>
      twoProportionZTest({ successes: 11, trials: 10 }, { successes: 1, trials: 10 }),
    ).toThrow(RangeError)
    expect(() =>
      twoProportionZTest({ successes: 1, trials: 0 }, { successes: 1, trials: 10 }),
    ).toThrow(RangeError)
  })
})

describe("welchTTest", () => {
  it("detects a clear difference", () => {
    const r = welchTTest([5.1, 4.9, 5.3, 5.0], [5.6, 5.8, 5.5, 5.9])
    expect(r.difference).toBeCloseTo(0.625, 10)
    // Hand-computed: se = sqrt(0.0291667/4 + 0.0333333/4) = 0.125, t = 0.625 / 0.125.
    expect(r.t).toBeCloseTo(5, 10)
    expect(r.df).toBeCloseTo(5.973, 3)
    expect(r.pValue).toBeCloseTo(0.0025, 4)
  })
  it("matches a textbook value", () => {
    // Equal sizes and variances: Welch reduces to Student's t with df = 2n - 2.
    const r = welchTTest([1, 2, 3, 4, 5], [2, 3, 4, 5, 6])
    expect(r.t).toBeCloseTo(1, 10)
    expect(r.df).toBeCloseTo(8, 10)
    expect(r.pValue).toBeCloseTo(0.3466, 3)
  })
  it("handles zero variance", () => {
    expect(welchTTest([1, 1], [1, 1]).pValue).toBe(1)
    expect(welchTTest([1, 1], [2, 2]).pValue).toBe(0)
  })
  it("requires two values per sample", () => {
    expect(() => welchTTest([1], [1, 2])).toThrow(RangeError)
  })
})
