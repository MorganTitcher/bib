import { describe, expect, it } from "vitest"
import { monteCarlo } from "../src/monte-carlo.ts"
import { minimalModel } from "./fixtures.ts"

describe("monteCarlo", () => {
  it("is deterministic for a seed", () => {
    const a = monteCarlo(minimalModel(), { runs: 50, seed: 42 })
    const b = monteCarlo(minimalModel(), { runs: 50, seed: 42 })
    expect(a).toEqual(b)
    const c = monteCarlo(minimalModel(), { runs: 50, seed: 43 })
    expect(c.outcomes.endingCash?.p50).not.toBe(a.outcomes.endingCash?.p50)
  })

  it("orders percentiles and samples only ranged bands", () => {
    const r = monteCarlo(minimalModel(), { runs: 100, seed: 1 })
    expect(r.sampled.sort()).toEqual(["channels.ads.spend", "channels.ads.unitCost.cac"])
    const cash = r.outcomes.endingCash
    expect(cash?.p10 ?? 0).toBeLessThanOrEqual(cash?.p50 ?? 0)
    expect(cash?.p50 ?? 0).toBeLessThanOrEqual(cash?.p90 ?? 0)
    expect(r.cash).toHaveLength(12)
    expect(r.mrr[11]?.p10 ?? 0).toBeLessThanOrEqual(r.mrr[11]?.p90 ?? 0)
    expect(r.probabilityCashOut).toBeGreaterThanOrEqual(0)
  })

  it("collapses to the point projection with no uncertainty", () => {
    const model = minimalModel({
      channels: [{ type: "paid", id: "ads", spend: 5000, unitCost: { kind: "cac", cac: 250 } }],
    })
    const r = monteCarlo(model, { runs: 5, outcomes: ["endingCash", "runwayMonths"] })
    expect(r.sampled).toEqual([])
    expect(r.outcomes.endingCash?.p10).toBe(r.outcomes.endingCash?.p90)
    expect(Object.keys(r.outcomes)).toEqual(["endingCash", "runwayMonths"])
  })

  it("reports null share for undefined outcomes and validates runs", () => {
    const r = monteCarlo(minimalModel({ opening: { cash: 1e9 }, channels: [] }), {
      runs: 3,
      outcomes: ["runwayMonths"],
    })
    expect(r.outcomes.runwayMonths?.nullShare).toBeGreaterThanOrEqual(0)
    expect(() => monteCarlo(minimalModel(), { runs: 0 })).toThrow(RangeError)
    expect(() => monteCarlo(minimalModel(), { runs: 1.5 })).toThrow(RangeError)
  })
})
