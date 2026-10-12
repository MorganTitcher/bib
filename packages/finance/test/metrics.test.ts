import { describe, expect, it } from "vitest"
import { project } from "../src/engine.ts"
import { isOutcome, OUTCOMES, outcomeLabel, outcomeValue, selectOutcome } from "../src/metrics.ts"
import { minimalModel } from "./fixtures.ts"

describe("metrics", () => {
  const p = project(minimalModel())

  it("reads every named outcome", () => {
    for (const outcome of OUTCOMES) {
      const value = outcomeValue(p, outcome)
      expect(value === null || Number.isFinite(value)).toBe(true)
    }
    expect(outcomeValue(p, "endingCash")).toBe(p.summary.ending.cash)
    expect(outcomeValue(p, "endingArr")).toBeCloseTo((outcomeValue(p, "endingMrr") ?? 0) * 12)
  })

  it("accepts custom selectors", () => {
    function firstMonthRevenue(proj: typeof p): number {
      return proj.months[0]?.revenue.net ?? 0
    }
    expect(selectOutcome(p, firstMonthRevenue)).toBe(p.months[0]?.revenue.net)
    expect(outcomeLabel(firstMonthRevenue)).toBe("firstMonthRevenue")
    expect(outcomeLabel(() => 1)).toBe("custom")
    expect(outcomeLabel("minCash")).toBe("minCash")
  })

  it("recognizes outcome names", () => {
    expect(isOutcome("runwayMonths")).toBe(true)
    expect(isOutcome("vibes")).toBe(false)
  })
})
