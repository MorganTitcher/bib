import { describe, expect, it } from "vitest"
import { tornado } from "../src/sensitivity.ts"
import { minimalModel } from "./fixtures.ts"

describe("tornado", () => {
  it("ranks inputs by swing, largest first", () => {
    const t = tornado(minimalModel())
    expect(t.outcome).toBe("endingCash")
    expect(t.mode).toBe("pct")
    const swings = t.rows.map((r) => r.swing ?? -1)
    expect(swings).toEqual([...swings].sort((a, b) => b - a))
    expect(t.rows[0]?.swing).toBeGreaterThan(0)
  })

  it("moves inputs ±pct and skips zero points", () => {
    const t = tornado(minimalModel(), { pct: 0.1 })
    const spend = t.rows.find((r) => r.path === "channels.ads.spend")
    expect(spend?.lowInput).toBeCloseTo(4500)
    expect(spend?.highInput).toBeCloseTo(5500)
    expect(t.rows.some((r) => r.path === "revenueDeductions.refundBps")).toBe(false)
  })

  it("clamps rate moves at their limits", () => {
    const model = minimalModel({
      streams: [
        {
          type: "subscription",
          id: "core",
          tiers: [{ id: "base", price: 100, mix: 1 }],
          retention: { kind: "constant", monthlyChurn: 0.9 },
        },
      ],
    })
    const row = tornado(model).rows.find((r) => r.path === "streams.core.retention.monthlyChurn")
    expect(row?.highInput).toBe(1)
  })

  it("band mode uses only ranged inputs at their bounds", () => {
    const t = tornado(minimalModel(), { mode: "band", limit: 10 })
    expect(t.rows.map((r) => r.path).sort()).toEqual([
      "channels.ads.spend",
      "channels.ads.unitCost.cac",
    ])
    const cac = t.rows.find((r) => r.path === "channels.ads.unitCost.cac")
    expect([cac?.lowInput, cac?.highInput]).toEqual([200, 400])
  })

  it("filters paths, limits rows and validates pct", () => {
    expect(tornado(minimalModel(), { paths: ["channels.ads.spend"] }).rows).toHaveLength(1)
    expect(tornado(minimalModel(), { limit: 2 }).rows).toHaveLength(2)
    expect(() => tornado(minimalModel(), { pct: 0 })).toThrow(RangeError)
  })

  it("puts undefined swings last", () => {
    // Runway is undefined when the business never burns, so some moves have no value.
    const t = tornado(minimalModel({ opening: { cash: 1e9 } }), { outcome: "runwayMonths" })
    const firstNull = t.rows.findIndex((r) => r.swing === null)
    if (firstNull >= 0) expect(t.rows.slice(firstNull).every((r) => r.swing === null)).toBe(true)
  })
})
