import { objectsToCsv } from "@bib/shared/csv"
import { formatPercent } from "@bib/shared/format"
import { currencyExponent, formatMoney, fromMajor, type Money } from "@bib/shared/money"
import type { CohortRow, Projection } from "./engine.ts"

/**
 * Turn an engine amount (a float in major units) into exact {@link Money},
 * rounded to the currency's minor unit. Throws on a non-finite amount.
 */
export function toMoney(value: number, currency: string): Money {
  if (!Number.isFinite(value)) throw new RangeError(`not a finite amount: ${value}`)
  const fixed = value.toFixed(currencyExponent(currency))
  // `(-0.001).toFixed(2)` is "-0.00"; normalize so it prints as $0.00.
  return fromMajor(/^-0(\.0*)?$/.test(fixed) ? fixed.slice(1) : fixed, currency)
}

/** Format an engine amount as currency, e.g. `formatAmount(1234.5, "USD")` → `"$1,234.50"`. */
export function formatAmount(value: number, currency: string, locale = "en-US"): string {
  return formatMoney(toMoney(value, currency), locale)
}

const round = (value: number, digits = 2): number => {
  const f = 10 ** digits
  return Math.round(value * f) / f
}

/** The monthly P&L, cash flow and balance as CSV, one row per month. */
export function projectionToCsv(projection: Projection): string {
  const rows = projection.months.map((m) => ({
    month: m.label,
    newCustomers: round(m.customers.new),
    churnedCustomers: round(m.customers.churned),
    activeCustomers: round(m.customers.active),
    mrrStarting: round(m.mrr.starting),
    mrrNew: round(m.mrr.new),
    mrrExpansion: round(m.mrr.expansion),
    mrrContraction: round(m.mrr.contraction),
    mrrPriceChange: round(m.mrr.priceChange),
    mrrChurn: round(m.mrr.churn),
    mrrEnding: round(m.mrr.ending),
    grossRevenue: round(m.revenue.gross),
    netRevenue: round(m.revenue.net),
    cogs: round(m.cogs.total),
    grossProfit: round(m.grossProfit),
    opex: round(m.opex.total),
    ebitda: round(m.ebitda),
    netIncome: round(m.netIncome),
    operatingCashFlow: round(m.cashFlow.operating),
    fundingIn: round(m.cashFlow.fundingIn),
    netCashFlow: round(m.cashFlow.net),
    cash: round(m.balance.cash),
    burn: round(m.burn),
    headcount: round(m.headcount),
  }))
  return objectsToCsv(rows)
}

/** The cohort table as CSV: one row per cohort, customer counts by age. */
export function cohortsToCsv(cohorts: readonly CohortRow[]): string {
  const width = Math.max(0, ...cohorts.map((c) => c.customers.length))
  const ages = Array.from({ length: width }, (_, i) => `age${i}`)
  const rows = cohorts.map((c) => {
    const row: Record<string, string | number> = { stream: c.stream, cohort: c.cohort }
    ages.forEach((age, i) => {
      const value = c.customers[i]
      row[age] = value === undefined ? "" : round(value)
    })
    return row
  })
  return objectsToCsv(rows, ["stream", "cohort", ...ages])
}

/** A short, plain-text summary of a projection. */
export function summaryLines(projection: Projection): string[] {
  const { summary, currency } = projection
  const money = (v: number) => formatAmount(v, currency)
  const lines = [
    `${projection.name} (${projection.months.length} months)`,
    `Net revenue: ${money(summary.totals.netRevenue)}`,
    `Gross margin: ${summary.grossMargin === null ? "n/a" : formatPercent(summary.grossMargin)}`,
    `EBITDA: ${money(summary.totals.ebitda)}`,
    `Ending MRR: ${money(summary.ending.mrr)} (ARR ${money(summary.ending.arr)})`,
    `Ending customers: ${Math.round(summary.ending.customers)}`,
    `Ending cash: ${money(summary.ending.cash)}`,
    `Lowest cash: ${money(summary.minCash.value)} in ${summary.minCash.label}`,
    `Runway: ${
      summary.runway.months === null
        ? "not burning"
        : `${round(summary.runway.months, 1)} months (${summary.runway.basis})`
    }`,
    `EBITDA break-even: ${summary.ebitdaBreakEven?.label ?? "not within horizon"}`,
  ]
  for (const warning of projection.warnings) lines.push(`Warning: ${warning}`)
  return lines
}
