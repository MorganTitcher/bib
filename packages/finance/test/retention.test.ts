import { describe, expect, it } from "vitest"
import { churnAt, retentionSchema, survivalAt, survivalSeries } from "../src/retention.ts"

describe("retention", () => {
  it("constant churn", () => {
    const curve = retentionSchema.parse({ kind: "constant", monthlyChurn: 0.1 })
    expect(churnAt(curve, 0)).toBe(0)
    expect(churnAt(curve, 5)).toBe(0.1)
    expect(survivalAt(curve, 2)).toBeCloseTo(0.81)
  })

  it("piecewise churn by age", () => {
    const curve = retentionSchema.parse({
      kind: "piecewise",
      segments: [
        { fromAge: 1, monthlyChurn: 0.1 },
        { fromAge: 4, monthlyChurn: 0.02 },
      ],
    })
    expect(churnAt(curve, 3)).toBe(0.1)
    expect(churnAt(curve, 4)).toBe(0.02)
    expect(churnAt(curve, 40)).toBe(0.02)
  })

  it("explicit survival curve with a tail", () => {
    const curve = retentionSchema.parse({ kind: "curve", survival: [0.8, 0.7], tailChurn: 0.05 })
    expect(survivalAt(curve, 1)).toBeCloseTo(0.8)
    expect(survivalAt(curve, 2)).toBeCloseTo(0.7)
    expect(survivalAt(curve, 3)).toBeCloseTo(0.7 * 0.95)
    const series = survivalSeries(curve, 4)
    expect(series[0]).toBe(1)
    for (let i = 1; i < series.length; i++) {
      expect(series[i] ?? 0).toBeLessThanOrEqual(series[i - 1] ?? 0)
    }
  })

  it("rejects malformed curves", () => {
    expect(
      retentionSchema.safeParse({
        kind: "piecewise",
        segments: [{ fromAge: 2, monthlyChurn: 0.1 }],
      }).success,
    ).toBe(false)
    expect(
      retentionSchema.safeParse({
        kind: "piecewise",
        segments: [
          { fromAge: 1, monthlyChurn: 0.1 },
          { fromAge: 1, monthlyChurn: 0.2 },
        ],
      }).success,
    ).toBe(false)
    expect(
      retentionSchema.safeParse({ kind: "curve", survival: [0.7, 0.8], tailChurn: 0.05 }).success,
    ).toBe(false)
  })
})
