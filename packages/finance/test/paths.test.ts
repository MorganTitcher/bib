import { describe, expect, it } from "vitest"
import { getBand, listBands, setBandPoint, withBandPoints } from "../src/paths.ts"
import { minimalModel } from "./fixtures.ts"

describe("paths", () => {
  it("lists bands with id-based paths and default provenance", () => {
    const model = minimalModel({
      meta: {
        name: "x",
        defaultProvenance: { source: "founder estimate", evidence: "hypothesis" },
      },
    })
    const entries = listBands(model)
    const paths = entries.map((e) => e.path)
    expect(paths).toContain("streams.core.tiers.base.price")
    expect(paths).toContain("channels.ads.unitCost.cac")
    expect(paths).toContain("streams.core.retention.monthlyChurn")
    expect(paths.some((p) => p.startsWith("scenarios") || p.startsWith("actuals"))).toBe(false)
    expect(entries.every((e) => e.provenance?.evidence === "hypothesis")).toBe(true)
  })

  it("gets bands by id or numeric index", () => {
    const model = minimalModel()
    expect(getBand(model, "channels.ads.spend")?.point).toBe(5000)
    expect(getBand(model, "channels.0.spend")?.point).toBe(5000)
    expect(getBand(model, "channels.ads.nope")).toBeUndefined()
    expect(getBand(model, "channels.ads")).toBeUndefined()
  })

  it("moves points on a copy, clamped to limits", () => {
    const model = minimalModel()
    const next = withBandPoints(model, {
      "channels.ads.spend": 9000,
      "streams.core.retention.monthlyChurn": 2,
    })
    expect(getBand(next, "channels.ads.spend")).toMatchObject({ point: 9000, high: 9000 })
    expect(getBand(next, "streams.core.retention.monthlyChurn")?.point).toBe(1)
    expect(getBand(model, "channels.ads.spend")?.point).toBe(5000)
    expect(getBand(setBandPoint(model, "channels.0.spend", 1), "channels.ads.spend")?.point).toBe(1)
  })

  it("throws on unknown paths", () => {
    expect(() => withBandPoints(minimalModel(), { "channels.ads.nope": 1 })).toThrow(RangeError)
    expect(() => withBandPoints(minimalModel(), { "nowhere.at.all": 1 })).toThrow(RangeError)
  })
})
