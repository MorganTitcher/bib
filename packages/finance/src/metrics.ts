import type { Projection } from "./engine.ts"

/** Headline numbers the analysis tools (tornado, Monte Carlo, backsolve, scenarios) can target. */
export const OUTCOMES = [
  "endingCash",
  "endingMrr",
  "endingArr",
  "endingCustomers",
  "totalNetRevenue",
  "totalGrossProfit",
  "totalEbitda",
  "totalNetIncome",
  "totalNewCustomers",
  "minCash",
  "runwayMonths",
] as const
export type Outcome = (typeof OUTCOMES)[number]

/** A named outcome or your own function of the projection. `null` means "not defined" (no runway when not burning). */
export type OutcomeSelector = Outcome | ((projection: Projection) => number | null)

export function isOutcome(value: string): value is Outcome {
  return (OUTCOMES as readonly string[]).includes(value)
}

/** Read one outcome from a projection. */
export function outcomeValue(projection: Projection, outcome: Outcome): number | null {
  const { summary } = projection
  switch (outcome) {
    case "endingCash":
      return summary.ending.cash
    case "endingMrr":
      return summary.ending.mrr
    case "endingArr":
      return summary.ending.arr
    case "endingCustomers":
      return summary.ending.customers
    case "totalNetRevenue":
      return summary.totals.netRevenue
    case "totalGrossProfit":
      return summary.totals.grossProfit
    case "totalEbitda":
      return summary.totals.ebitda
    case "totalNetIncome":
      return summary.totals.netIncome
    case "totalNewCustomers":
      return summary.totals.newCustomers
    case "minCash":
      return summary.minCash.value
    case "runwayMonths":
      return summary.runway.months
  }
}

/** Resolve a selector to a value. */
export function selectOutcome(projection: Projection, selector: OutcomeSelector): number | null {
  return typeof selector === "function" ? selector(projection) : outcomeValue(projection, selector)
}

/** A label for reports: the outcome name, or `"custom"` for a function. */
export function outcomeLabel(selector: OutcomeSelector): string {
  return typeof selector === "function" ? selector.name || "custom" : selector
}
