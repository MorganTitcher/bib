import { describe, expect, it } from "vitest"
import { project } from "../src/engine.ts"
import { getBand } from "../src/paths.ts"
import { applyScenario, compareScenarios, headline } from "../src/scenarios.ts"
import { minimalModel } from "./fixtures.ts"

const withScenarios = () =>
  minimalModel({
    scenarios: [
      { id: "lean", overrides: { "channels.ads.spend": "low", "channels.ads.unitCost.cac": 300 } },
      { id: "push", name: "Push", overrides: { "channels.ads.spend": "high" } },
    ],
  })

describe("scenarios", () => {
  it("applies band bounds and numbers", () => {
    const model = applyScenario(withScenarios(), "lean")
    expect(getBand(model, "channels.ads.spend")?.point).toBe(4000)
    expect(getBand(model, "channels.ads.unitCost.cac")?.point).toBe(300)
  })

  it("throws on an unknown scenario", () => {
    expect(() => applyScenario(withScenarios(), "nope")).toThrow(RangeError)
  })

  it("summarizes a projection", () => {
    const h = headline(project(minimalModel()))
    expect(h.endingCash).toBe(project(minimalModel()).summary.ending.cash)
    expect(typeof h.totalNetRevenue).toBe("number")
  })

  it("compares each scenario to the base with deltas", () => {
    const c = compareScenarios(withScenarios())
    expect(c.scenarios.map((s) => s.id)).toEqual(["lean", "push"])
    const push = c.scenarios[1]
    expect(push?.name).toBe("Push")
    expect(push?.headline.endingCustomers ?? 0).toBeGreaterThan(c.base.headline.endingCustomers)
    expect(push?.delta.endingCash).toBeCloseTo(
      (push?.headline.endingCash ?? 0) - c.base.headline.endingCash,
    )
    expect(compareScenarios(withScenarios(), ["push"]).scenarios).toHaveLength(1)
  })
})
