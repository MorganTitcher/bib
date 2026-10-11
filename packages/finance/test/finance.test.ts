import { describe, expect, it } from "vitest"
import {
  annualGrr,
  annualNrr,
  breakevenCustomers,
  breakevenRoas,
  cac,
  cacPaybackMonths,
  cpm,
  funnel,
  lifetimeMonths,
  ltv,
  mer,
  parseAssumptions,
  quickRatio,
  ratio,
  roas,
  runwayMonths,
  sensitivity,
  unitEconomics,
} from "../src/index.ts"

const base = parseAssumptions({
  arpa: 49,
  grossMargin: 0.8,
  monthlyChurn: 0.03,
  monthlyExpansion: 0.01,
  acquisitionSpend: 12000,
  newCustomers: 60,
  fixedCostsMonthly: 30000,
  cash: 250000,
  customers: 600,
})

describe("ratio", () => {
  it("returns null instead of Infinity or NaN", () => {
    expect(ratio(1, 0)).toBeNull()
    expect(ratio(0, 0)).toBeNull()
    expect(ratio(6, 3)).toBe(2)
  })
})

describe("unit economics primitives", () => {
  it("computes CAC and treats zero customers as undefined", () => {
    expect(cac(12000, 60)).toBe(200)
    expect(cac(12000, 0)).toBeNull()
  })

  it("caps lifetime so zero or tiny churn cannot imply infinite LTV", () => {
    expect(lifetimeMonths(0.05)).toBeCloseTo(20)
    expect(lifetimeMonths(0)).toBe(120)
    expect(lifetimeMonths(0.001, 60)).toBe(60)
  })

  it("computes LTV on a gross-margin basis", () => {
    expect(ltv(100, 0.5, 0.1)).toBeCloseTo(500)
  })

  it("computes CAC payback in months of contribution", () => {
    expect(cacPaybackMonths(200, 50, 0.8)).toBeCloseTo(5)
    expect(cacPaybackMonths(null, 50, 0.8)).toBeNull()
    expect(cacPaybackMonths(200, 50, 0)).toBeNull()
  })

  it("compounds retention over twelve months", () => {
    expect(annualGrr(0)).toBe(1)
    expect(annualGrr(0.03)).toBeCloseTo(0.6938, 4)
    expect(annualNrr(0.03, 0.03)).toBeGreaterThan(annualGrr(0.03))
  })

  it("computes quick ratio and returns null with no churn", () => {
    expect(quickRatio(800, 200, 250)).toBe(4)
    expect(quickRatio(800, 200, 0)).toBeNull()
  })

  it("rounds breakeven customers up", () => {
    expect(breakevenCustomers(1000, 30, 1)).toBe(34)
    expect(breakevenCustomers(1000, 30, 0)).toBeNull()
  })

  it("reports no runway when the business is not burning", () => {
    expect(runwayMonths(100000, 10000)).toBe(10)
    expect(runwayMonths(100000, 0)).toBeNull()
    expect(runwayMonths(100000, -500)).toBeNull()
  })
})

describe("marketing calculators", () => {
  it("computes efficiency ratios", () => {
    expect(roas(5000, 1000)).toBe(5)
    expect(mer(20000, 4000)).toBe(5)
    expect(cpm(50, 10000)).toBe(5)
    expect(breakevenRoas(0.5)).toBe(2)
    expect(roas(5000, 0)).toBeNull()
  })

  it("walks a funnel from spend to customers", () => {
    const result = funnel({
      spend: 1000,
      cpm: 10,
      ctr: 0.01,
      landingToLead: 0.1,
      leadToCustomer: 0.2,
    })
    expect(result.impressions).toBe(100000)
    expect(result.clicks).toBe(1000)
    expect(result.customers).toBeCloseTo(20)
    expect(result.costPerCustomer).toBeCloseTo(50)
  })
})

describe("unitEconomics", () => {
  const report = unitEconomics(base)

  it("embeds the assumptions it was computed from", () => {
    expect(report.assumptions).toEqual(base)
  })

  it("derives the headline metrics", () => {
    expect(report.metrics.cac).toBe(200)
    expect(report.metrics.mrr).toBe(29400)
    expect(report.metrics.ltv).toBeCloseTo(49 * 0.8 * (1 / 0.03))
    expect(report.metrics.ltvToCac).toBeCloseTo(report.metrics.ltv / 200)
    expect(report.metrics.monthlyNetBurn).toBeCloseTo(30000 + 12000 - 29400 * 0.8)
    expect(report.metrics.lifetimeCapped).toBe(false)
  })

  it("warns when lifetime is capped", () => {
    const capped = unitEconomics(parseAssumptions({ ...base, monthlyChurn: 0 }))
    expect(capped.metrics.lifetimeCapped).toBe(true)
    expect(capped.warnings.some((w) => w.includes("capped"))).toBe(true)
  })

  it("serialises without losing undefined ratios", () => {
    const empty = unitEconomics(parseAssumptions({ ...base, newCustomers: 0 }))
    const json = JSON.parse(JSON.stringify(empty))
    expect(json.metrics.cac).toBeNull()
    expect(json.metrics.ltvToCac).toBeNull()
  })

  it("warns when customers contribute no margin, so payback never happens", () => {
    const zero = unitEconomics(parseAssumptions({ ...base, grossMargin: 0 }))
    expect(zero.metrics.cacPaybackMonths).toBeNull()
    expect(zero.warnings.some((w) => w.includes("never paid back"))).toBe(true)
  })

  it("rejects impossible assumptions", () => {
    expect(() => parseAssumptions({ ...base, grossMargin: 1.5 })).toThrow()
    expect(() => parseAssumptions({ ...base, newCustomers: 2.5 })).toThrow()
  })
})

describe("sensitivity", () => {
  it("scales one field and keeps the scenario valid", () => {
    const rows = sensitivity(base, "monthlyChurn", [0.5, 1, 2])
    expect(rows.map((r) => r.value)).toEqual([0.015, 0.03, 0.06])
    expect(rows[0]?.report.metrics.ltv).toBeGreaterThan(rows[2]?.report.metrics.ltv ?? Infinity)
  })

  it("rounds integer fields and clamps rates", () => {
    expect(sensitivity(base, "newCustomers", [1.25])[0]?.value).toBe(75)
    expect(sensitivity(base, "grossMargin", [2])[0]?.value).toBe(1)
  })
})
