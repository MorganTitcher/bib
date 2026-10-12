import { describe, expect, it } from "vitest"
import { channelStream, type Projection, project } from "../src/engine.ts"
import { assertModel } from "../src/schema.ts"
import { EXAMPLES, exampleModel, minimalInput, minimalModel } from "./fixtures.ts"

function maxAbs(values: number[]): number {
  return values.reduce((m, v) => Math.max(m, Math.abs(v)), 0)
}

function expectBalanced(p: Projection): void {
  expect(maxAbs(p.months.map((m) => m.balance.check))).toBeLessThan(1e-6)
}

function expectWaterfallsHold(p: Projection): void {
  for (const m of p.months) {
    const w = m.mrr
    const ending = w.starting + w.new + w.expansion - w.contraction - w.churn + w.priceChange
    expect(ending).toBeCloseTo(w.ending, 6)
  }
  for (let i = 1; i < p.months.length; i++) {
    expect(p.months[i]?.mrr.starting).toBeCloseTo(p.months[i - 1]?.mrr.ending ?? Number.NaN, 6)
  }
}

/** Everything that touches the balance sheet at once. */
const richInput = minimalInput({
  meta: { name: "Rich", startMonth: "2027-01", horizonMonths: 30 },
  opening: { cash: 200_000, receivables: 10_000, payables: 5_000, deferredRevenue: 6_000 },
  streams: [
    {
      type: "subscription",
      id: "core",
      tiers: [{ id: "base", price: 100, mix: 1 }],
      annualPrepaidShare: 0.3,
      expansion: 0.01,
      contraction: 0.005,
      retention: { kind: "constant", monthlyChurn: 0.04 },
      opening: { customers: 50, arpa: 90 },
      priceChanges: [{ month: "2027-07", pct: 0.1, appliesTo: "all" }],
    },
    { type: "oneTime", id: "setup", perNewCustomerOf: "core", amount: 200 },
  ],
  revenueDeductions: { discountBps: 200, refundBps: 100, paymentFeeBps: 290 },
  costs: {
    cogs: { perActiveCustomer: 5 },
    headcount: [{ id: "eng", department: "rd", salary: 120_000, count: 2, benefitsLoad: 0.2 }],
    opex: [{ id: "rent", department: "ga", rule: "fixed", amount: 3000 }],
    capex: [{ id: "laptops", month: "2027-02", amount: 12_000, usefulLifeMonths: 24 }],
  },
  workingCapital: { dsoDays: 30, dpoDays: 20, badDebtBps: 50 },
  taxes: { rate: 0.25 },
  funding: [
    { type: "equity", id: "seed", month: "2027-03", amount: 500_000 },
    {
      type: "debt",
      id: "loan",
      month: "2027-04",
      principal: 100_000,
      annualRate: 0.1,
      termMonths: 12,
      interestOnlyMonths: 3,
    },
    {
      type: "rbf",
      id: "rbf",
      month: "2027-06",
      amount: 50_000,
      revenueShare: 0.1,
      repaymentCap: 1.3,
    },
    { type: "grant", id: "grant", month: 1, amount: 20_000 },
  ],
  events: [{ id: "award", month: 5, kind: "otherIncome", amount: 1000 }],
})

describe("project", () => {
  it("produces one row per month with labels", () => {
    const p = project(minimalModel())
    expect(p.months).toHaveLength(12)
    expect(p.months[0]?.label).toBe("M1")
    expect(p.currency).toBe("USD")
  })

  it("acquires customers from spend / CAC", () => {
    const p = project(minimalModel())
    expect(p.months[0]?.customers.byChannel.ads).toBeCloseTo(20)
    expect(p.months[0]?.channelSpend.ads).toBeCloseTo(5000)
    expect(p.months[0]?.mrr.new).toBeCloseTo(2000)
  })

  it("keeps the balance sheet balanced with working capital, prepaid, debt, RBF, capex and tax", () => {
    const p = project(assertModel(richInput))
    expectBalanced(p)
    expectWaterfallsHold(p)
    const rows = p.months
    expect(rows.some((m) => m.balance.receivables > 0)).toBe(true)
    expect(rows.some((m) => m.balance.payables > 0)).toBe(true)
    expect(rows.some((m) => m.balance.deferredRevenue > 0)).toBe(true)
    expect(rows.some((m) => m.interest > 0)).toBe(true)
    expect(rows.some((m) => m.depreciation > 0)).toBe(true)
    expect(rows[3]?.balance.debt).toBeGreaterThan(0)
    expect(rows.at(-1)?.balance.debt ?? 1).toBeCloseTo(0, 6)
    expect(rows[2]?.cashFlow.fundingIn).toBe(500_000)
    expect(rows[1]?.cashFlow.investing).toBeCloseTo(-12_000)
    expect(rows.some((m) => m.mrr.priceChange > 0)).toBe(true)
  })

  it("does not tax losses and uses the carryforward", () => {
    const p = project(assertModel(richInput))
    for (const m of p.months) {
      if (m.pretaxIncome <= 0) expect(m.tax).toBe(0)
    }
  })

  it("reports runway when burning and a cash-out month when cash runs out", () => {
    const p = project(minimalModel({ opening: { cash: 1000 } }))
    expect(p.summary.cashOutMonth).not.toBeNull()
    expect(p.summary.runway.basis).toBe("projected")
  })

  it("applies acquisition seasonality", () => {
    const flat = project(minimalModel())
    const seasonal = project(
      minimalModel({ seasonality: { acquisition: [2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1] } }),
    )
    expect(seasonal.months[0]?.customers.new).toBeCloseTo((flat.months[0]?.customers.new ?? 0) * 2)
    expect(seasonal.months[1]?.customers.new).toBeCloseTo(flat.months[1]?.customers.new ?? 0)
  })

  it("builds cohorts that start at acquisition", () => {
    const p = project(minimalModel())
    const first = p.cohorts.find((c) => c.stream === "core" && c.startIndex === 0)
    expect(first?.customers[0]).toBeCloseTo(20)
    expect(first?.customers[1]).toBeCloseTo(19)
  })

  it("finds the stream a channel acquires into", () => {
    const model = minimalModel()
    const channel = model.channels[0]
    if (channel === undefined) throw new Error("fixture changed")
    expect(channelStream(model, channel)).toBe("core")
  })

  it.each(EXAMPLES)("example %s loads, balances and keeps MRR waterfalls", (name) => {
    const p = project(exampleModel(name))
    expectBalanced(p)
    expectWaterfallsHold(p)
    expect(p.summary.totals.netRevenue).toBeGreaterThan(0)
  })
})
