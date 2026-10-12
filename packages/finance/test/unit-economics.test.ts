import { describe, expect, it } from "vitest"
import { retentionSchema } from "../src/retention.ts"
import {
  annualGrr,
  annualNrr,
  cacFromFunnel,
  lifetimeValue,
  monthlyDiscountRate,
  monthlyNrr,
  paybackMonths,
  ratio,
  roas,
  unitEconomics,
} from "../src/unit-economics.ts"
import { minimalModel } from "./fixtures.ts"

const constant = (churn: number) => retentionSchema.parse({ kind: "constant", monthlyChurn: churn })

describe("retention rates", () => {
  it("adds expansion on the starting base (not compounded)", () => {
    expect(monthlyNrr({ monthlyChurn: 0.02, expansion: 0.03 })).toBeCloseTo(1.01, 12)
    expect(monthlyNrr({ monthlyChurn: 0.02, expansion: 0.03, contraction: 0.01 })).toBeCloseTo(
      1,
      12,
    )
  })

  it("compounds a year and floors at zero", () => {
    expect(annualNrr({ monthlyChurn: 0.02, expansion: 0.03 })).toBeCloseTo(1.01 ** 12)
    expect(annualGrr({ monthlyChurn: 0.02, expansion: 0.03 })).toBeCloseTo(0.98 ** 12)
    expect(annualNrr({ monthlyChurn: 1.5, expansion: 0 })).toBe(0)
  })
})

describe("ratios", () => {
  it("returns null instead of dividing by zero", () => {
    expect(ratio(10, 2)).toBe(5)
    expect(ratio(10, 0)).toBeNull()
    expect(ratio(Number.NaN, 2)).toBeNull()
    expect(cacFromFunnel({ cpm: 12, ctr: 0.01, cvr: 0.02 })).toBeCloseTo(60)
    expect(cacFromFunnel({ cpm: 12, ctr: 0, cvr: 0.02 })).toBeNull()
    expect(roas(300, 100)).toBe(3)
    expect(roas(300, 0)).toBeNull()
    expect(monthlyDiscountRate(0)).toBe(0)
    expect((1 + monthlyDiscountRate(0.12)) ** 12).toBeCloseTo(1.12)
  })
})

describe("lifetimeValue", () => {
  it("sums gross profit over the cap", () => {
    const v = lifetimeValue({ arpa: 100, grossMargin: 0.8, retention: constant(0.1), capMonths: 3 })
    expect(v.contribution).toEqual([80, expect.closeTo(72, 9), expect.closeTo(64.8, 9)])
    expect(v.ltv).toBeCloseTo(216.8)
    expect(v.survivalAtCap).toBeCloseTo(0.9 ** 3)
  })

  it("adds upfront revenue and discounts", () => {
    const plain = lifetimeValue({
      arpa: 100,
      grossMargin: 1,
      retention: constant(0),
      capMonths: 12,
    })
    const disc = lifetimeValue({
      arpa: 100,
      grossMargin: 1,
      retention: constant(0),
      capMonths: 12,
      monthlyDiscountRate: 0.01,
      upfront: 50,
    })
    expect(plain.ltv).toBeCloseTo(1200)
    expect(disc.upfrontContribution).toBe(50)
    expect(disc.ltv).toBeLessThan(1250)
    expect(disc.ltv).toBeGreaterThan(1100)
  })

  it("computes payback with interpolation", () => {
    expect(paybackMonths(150, [100, 100, 100])).toBeCloseTo(1.5)
    expect(paybackMonths(50, [100], 60)).toBe(0)
    expect(paybackMonths(1000, [100, 100])).toBeNull()
  })
})

describe("unitEconomics", () => {
  it("reports CAC, LTV, LTV:CAC and payback for a paid channel", () => {
    const ue = unitEconomics(minimalModel())
    const ads = ue.channels.find((c) => c.channel === "ads")
    expect(ads?.cac).toBeCloseTo(250)
    expect(ads?.ltv).toBeGreaterThan(0)
    expect(ads?.ltvToCac).toBeCloseTo((ads?.ltv ?? 0) / 250)
    expect(ads?.paybackMonths).toBeGreaterThan(0)
    expect(ue.blended.channel).toBe("blended")
  })

  it("reports a zero-CAC channel as null with a warning", () => {
    const ue = unitEconomics(
      minimalModel({ channels: [{ type: "organic", id: "word-of-mouth", customers: 10 }] }),
    )
    const row = ue.channels[0]
    expect(row?.cac).toBe(0)
    expect(row?.ltvToCac).toBeNull()
    expect(row?.paybackMonths).toBeNull()
    expect(ue.warnings).toContain(
      "word-of-mouth: CAC is zero (no spend is attributed to it), so LTV:CAC is undefined and reported as null",
    )
  })

  it("warns that a capped LTV is a ceiling", () => {
    const model = minimalModel({
      meta: { name: "x", horizonMonths: 12, lifetimeCapMonths: 12 },
      streams: [
        {
          type: "subscription",
          id: "core",
          tiers: [{ id: "base", price: 100, mix: 1 }],
          retention: { kind: "constant", monthlyChurn: 0.01 },
        },
      ],
    })
    const ue = unitEconomics(model)
    const warning = ue.warnings.find((w) => w.includes("lifetime cap"))
    expect(warning).toMatch(
      /^core: 88\.6% of customers are still active at the 12-month lifetime cap/,
    )
    expect(warning).toMatch(/treat it as a ceiling, not an estimate$/)
  })

  it("warns when a channel acquires nobody", () => {
    const ue = unitEconomics(
      minimalModel({ channels: [{ type: "organic", id: "quiet", customers: 0 }] }),
    )
    expect(ue.channels[0]?.cac).toBeNull()
    expect(ue.warnings.some((w) => w.startsWith("quiet: no customers were acquired"))).toBe(true)
  })

  it("reports monthly and annual NRR per stream", () => {
    const model = minimalModel({
      streams: [
        {
          type: "subscription",
          id: "core",
          tiers: [{ id: "base", price: 100, mix: 1 }],
          expansion: 0.03,
          retention: { kind: "constant", monthlyChurn: 0.02 },
        },
      ],
    })
    const stream = unitEconomics(model).streams[0]
    expect(stream?.nrrMonthly).toBeCloseTo(1.01, 12)
    expect(stream?.nrrAnnual).toBeCloseTo(1.01 ** 12)
  })
})
