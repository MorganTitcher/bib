import { describe, expect, it } from "vitest"
import { project } from "../src/engine.ts"
import { metricValue, varianceVsActuals } from "../src/variance.ts"
import { minimalModel } from "./fixtures.ts"

describe("variance", () => {
  const base = minimalModel()
  const p = project(base)
  const mrr0 = p.months[0]?.mrr.ending ?? 0
  const mrr1 = p.months[1]?.mrr.ending ?? 0

  it("reads metrics from a month row", () => {
    const row = p.months[0]
    if (row === undefined) throw new Error("no month")
    expect(metricValue(row, "mrr")).toBe(row.mrr.ending)
    expect(metricValue(row, "cash")).toBe(row.balance.cash)
    expect(metricValue(row, "newCustomers")).toBe(row.customers.new)
  })

  it("computes MAPE, bias and share within tolerance", () => {
    const model = minimalModel({
      actuals: [
        { month: 0, metric: "mrr", value: mrr0 },
        { month: 1, metric: "mrr", value: mrr1 / 1.25 },
        { month: 2, metric: "newCustomers", value: 0 },
        { month: 40, metric: "mrr", value: 1 },
      ],
    })
    const report = varianceVsActuals(model)
    expect(report.tolerance).toBe(0.1)
    expect(report.outsideHorizon).toBe(1)
    const mrr = report.metrics.find((m) => m.metric === "mrr")
    expect(mrr?.points).toHaveLength(2)
    expect(mrr?.mape).toBeCloseTo(0.125)
    expect(mrr?.withinTolerance).toBeCloseTo(0.5)
    expect(mrr?.bias).toBeCloseTo(0.125)
    const zero = report.metrics.find((m) => m.metric === "newCustomers")
    expect(zero?.skippedZero).toBe(1)
    expect(zero?.points[0]?.pctError).toBeNull()
  })

  it("respects a custom tolerance and rejects a negative one", () => {
    const model = minimalModel({ actuals: [{ month: 1, metric: "mrr", value: mrr1 / 1.25 }] })
    const loose = varianceVsActuals(model, project(model), { tolerance: 0.3 })
    expect(loose.metrics[0]?.withinTolerance).toBe(1)
    expect(() => varianceVsActuals(model, project(model), { tolerance: -1 })).toThrow()
  })

  it("returns no metrics without actuals", () => {
    expect(varianceVsActuals(base).metrics).toEqual([])
  })
})
