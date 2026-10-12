import { describe, expect, it } from "vitest"
import { project } from "../src/engine.ts"
import { backsolve, breakEven } from "../src/solve.ts"
import { exampleModel, minimalModel } from "./fixtures.ts"

describe("backsolve", () => {
  it("finds the input that hits a target", () => {
    const result = backsolve(minimalModel(), {
      path: "channels.ads.spend",
      outcome: "endingCustomers",
      target: 300,
      lo: 0,
      hi: 50_000,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(Math.abs(result.value.outcomeValue - 300)).toBeLessThanOrEqual(3)
    expect(result.value.iterations).toBeGreaterThan(0)
    expect(project(result.value.model).summary.ending.customers).toBeCloseTo(
      result.value.outcomeValue,
    )
  })

  it("errors when the target is not bracketed", () => {
    const result = backsolve(minimalModel(), {
      path: "channels.ads.spend",
      outcome: "endingCustomers",
      target: 1e9,
      lo: 0,
      hi: 10_000,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/widen lo\/hi/)
  })

  it("errors on an unknown path or empty bounds", () => {
    const unknown = backsolve(minimalModel(), { path: "nope", outcome: "endingCash", target: 0 })
    expect(unknown.ok).toBe(false)
    const empty = backsolve(minimalModel(), {
      path: "channels.ads.spend",
      outcome: "endingCash",
      target: 0,
      lo: 10,
      hi: 5,
    })
    expect(empty.ok).toBe(false)
  })
})

describe("breakEven", () => {
  it("finds the first month that stays profitable", () => {
    const p = project(exampleModel("marketplace"))
    const be = breakEven(p)
    expect(be.ebitda?.label).toBe(p.summary.ebitdaBreakEven?.label)
    if (be.netIncome !== null) {
      for (const row of p.months.slice(be.netIncome.index))
        expect(row.netIncome).toBeGreaterThanOrEqual(0)
    }
  })

  it("returns nulls for a model that never breaks even", () => {
    const be = breakEven(
      project(
        minimalModel({
          opening: { cash: 0 },
          streams: [
            {
              type: "subscription",
              id: "core",
              tiers: [{ id: "base", price: 1, mix: 1 }],
              retention: { kind: "constant", monthlyChurn: 0.5 },
            },
          ],
        }),
      ),
    )
    expect(be.ebitda).toBeNull()
    expect(be.netIncome).toBeNull()
  })
})
