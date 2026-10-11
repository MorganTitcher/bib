import { describe, expect, it } from "vitest"
import {
  compareCtr,
  compareDailyValues,
  impactVerdict,
  rollingAverage,
  splitAroundChange,
} from "../src/impact.ts"

describe("compareCtr", () => {
  it("detects a significant improvement", () => {
    const r = compareCtr({ clicks: 200, impressions: 10_000 }, { clicks: 320, impressions: 10_000 })
    expect(r.before).toBeCloseTo(0.02)
    expect(r.after).toBeCloseTo(0.032)
    expect(r.verdict).toBe("improved")
    expect(r.pValue).toBeLessThan(0.05)
  })

  it("reports no significant change for noise", () => {
    expect(
      compareCtr({ clicks: 100, impressions: 10_000 }, { clicks: 104, impressions: 10_000 })
        .verdict,
    ).toBe("no-significant-change")
  })

  it("refuses to judge tiny samples", () => {
    expect(
      compareCtr({ clicks: 3, impressions: 100 }, { clicks: 9, impressions: 100 }).verdict,
    ).toBe("insufficient-data")
  })

  it("rejects an invalid alpha", () => {
    expect(() =>
      compareCtr(
        { clicks: 200, impressions: 10_000 },
        { clicks: 300, impressions: 10_000 },
        { alpha: 1 },
      ),
    ).toThrow()
  })
})

describe("compareDailyValues", () => {
  const before = [10, 11, 9, 10, 12, 10, 11]
  const after = [20, 21, 19, 22, 20, 21, 20]

  it("uses direction to name the verdict", () => {
    expect(compareDailyValues(before, after).verdict).toBe("improved")
    expect(compareDailyValues(before, after, { direction: "lower-is-better" }).verdict).toBe(
      "regressed",
    )
  })

  it("needs minDays per side", () => {
    expect(compareDailyValues([1, 2], [3, 4]).verdict).toBe("insufficient-data")
  })
})

describe("impactVerdict", () => {
  it("is neutral when not significant", () => {
    expect(impactVerdict(5, 0.2, {})).toBe("no-significant-change")
    expect(impactVerdict(-5, 0.01, {})).toBe("regressed")
  })
})

describe("splitAroundChange", () => {
  it("excludes the change day and non-finite values", () => {
    const series = [
      { date: "2026-10-08", value: 1 },
      { date: "2026-10-09", value: Number.NaN },
      { date: "2026-10-10", value: 2 },
      { date: "2026-10-11", value: 99 },
      { date: "2026-10-12", value: 3 },
      { date: "2026-10-20", value: 4 },
    ]
    expect(splitAroundChange(series, "2026-10-11", 3)).toEqual({ before: [1, 2], after: [3] })
    expect(() => splitAroundChange(series, "2026-10-11", 0)).toThrow()
  })
})

describe("rollingAverage", () => {
  it("is trailing and length-preserving", () => {
    expect(rollingAverage([1, 2, 3, 4], 2)).toEqual([1, 1.5, 2.5, 3.5])
    expect(rollingAverage([], 3)).toEqual([])
    expect(() => rollingAverage([1], 1.5)).toThrow()
  })
})
