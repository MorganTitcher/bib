import type { BusinessAssumptions } from "./assumptions.ts"
import { ratio } from "./ratio.ts"

/** Customer acquisition cost: spend per new customer. */
export function cac(acquisitionSpend: number, newCustomers: number): number | null {
  return ratio(acquisitionSpend, newCustomers)
}

/** Expected customer lifetime in months (1 / churn), capped. */
export function lifetimeMonths(monthlyChurn: number, capMonths = 120): number {
  if (monthlyChurn <= 0) return capMonths
  return Math.min(1 / monthlyChurn, capMonths)
}

/** Gross-margin contribution per account per month. */
export function contributionPerAccount(arpa: number, grossMargin: number): number {
  return arpa * grossMargin
}

/** Lifetime value on a gross-margin basis. */
export function ltv(
  arpa: number,
  grossMargin: number,
  monthlyChurn: number,
  capMonths = 120,
): number {
  return contributionPerAccount(arpa, grossMargin) * lifetimeMonths(monthlyChurn, capMonths)
}

/** Months of gross margin needed to recover CAC. */
export function cacPaybackMonths(
  cacValue: number | null,
  arpa: number,
  grossMargin: number,
): number | null {
  if (cacValue === null) return null
  return ratio(cacValue, contributionPerAccount(arpa, grossMargin))
}

/** Gross revenue retention over twelve months, excluding expansion. */
export function annualGrr(monthlyChurn: number): number {
  return (1 - monthlyChurn) ** 12
}

/** Net revenue retention over twelve months, including expansion. */
export function annualNrr(monthlyChurn: number, monthlyExpansion: number): number {
  return ((1 + monthlyExpansion) * (1 - monthlyChurn)) ** 12
}

/** SaaS quick ratio: growth MRR over lost MRR. Above 4 is strong. */
export function quickRatio(
  newMrr: number,
  expansionMrr: number,
  churnedMrr: number,
): number | null {
  return ratio(newMrr + expansionMrr, churnedMrr)
}

/** Rule of 40: growth rate plus profit margin, both as percentages. */
export function ruleOf40(growthPct: number, profitMarginPct: number): number {
  return growthPct + profitMarginPct
}

/** Customers needed for gross margin to cover fixed costs. */
export function breakevenCustomers(
  fixedCostsMonthly: number,
  arpa: number,
  grossMargin: number,
): number | null {
  const value = ratio(fixedCostsMonthly, contributionPerAccount(arpa, grossMargin))
  return value === null ? null : Math.ceil(value)
}

/** Months of runway at a monthly net burn. Null when the business is not burning. */
export function runwayMonths(cash: number, monthlyNetBurn: number): number | null {
  if (monthlyNetBurn <= 0) return null
  return cash / monthlyNetBurn
}

export interface UnitEconomicsReport {
  assumptions: BusinessAssumptions
  metrics: {
    cac: number | null
    lifetimeMonths: number
    lifetimeCapped: boolean
    contributionPerAccount: number
    ltv: number
    ltvToCac: number | null
    cacPaybackMonths: number | null
    annualGrr: number
    annualNrr: number
    mrr: number
    monthlyGrossProfit: number
    monthlyNetBurn: number
    breakevenCustomers: number | null
    runwayMonths: number | null
  }
  warnings: string[]
}

/**
 * Compute the full unit-economics picture from one set of assumptions.
 *
 * The report embeds the assumptions it was computed from, so a number can never
 * be quoted without the inputs that produced it.
 */
export function unitEconomics(assumptions: BusinessAssumptions): UnitEconomicsReport {
  const a = assumptions
  const cacValue = cac(a.acquisitionSpend, a.newCustomers)
  const life = lifetimeMonths(a.monthlyChurn, a.lifetimeCapMonths)
  const ltvValue = ltv(a.arpa, a.grossMargin, a.monthlyChurn, a.lifetimeCapMonths)
  const mrr = a.arpa * a.customers
  const monthlyGrossProfit = mrr * a.grossMargin
  const monthlyNetBurn = a.fixedCostsMonthly + a.acquisitionSpend - monthlyGrossProfit
  const ltvToCac = cacValue === null ? null : ratio(ltvValue, cacValue)
  const payback = cacPaybackMonths(cacValue, a.arpa, a.grossMargin)

  const warnings: string[] = []
  const lifetimeCapped = a.monthlyChurn <= 0 || 1 / a.monthlyChurn > a.lifetimeCapMonths
  if (lifetimeCapped)
    warnings.push(
      `Lifetime capped at ${a.lifetimeCapMonths} months; LTV is a ceiling, not an estimate.`,
    )
  if (cacValue === null) warnings.push("No new customers in the period, so CAC is undefined.")
  if (ltvToCac !== null && ltvToCac < 3)
    warnings.push(
      "LTV:CAC is below 3; acquisition is unlikely to pay for itself with margin to spare.",
    )
  if (payback !== null && payback > 12) warnings.push("CAC payback exceeds 12 months.")
  if (cacValue !== null && payback === null)
    warnings.push("Each customer contributes no gross margin, so CAC is never paid back.")

  return {
    assumptions,
    metrics: {
      cac: cacValue,
      lifetimeMonths: life,
      lifetimeCapped,
      contributionPerAccount: contributionPerAccount(a.arpa, a.grossMargin),
      ltv: ltvValue,
      ltvToCac,
      cacPaybackMonths: payback,
      annualGrr: annualGrr(a.monthlyChurn),
      annualNrr: annualNrr(a.monthlyChurn, a.monthlyExpansion),
      mrr,
      monthlyGrossProfit,
      monthlyNetBurn,
      breakevenCustomers: breakevenCustomers(a.fixedCostsMonthly, a.arpa, a.grossMargin),
      runwayMonths: runwayMonths(a.cash, monthlyNetBurn),
    },
    warnings,
  }
}
