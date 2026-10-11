import { z } from "zod"

const rate = z.number().min(0).max(1)
const money = z.number().min(0)

/**
 * Monthly operating assumptions for a recurring-revenue business.
 *
 * Rates are monthly fractions (0.03 = 3% per month). Money is in one currency
 * unit throughout; the package never converts currencies.
 */
export const BusinessAssumptions = z.object({
  /** Average revenue per account per month. */
  arpa: money,
  /** Gross margin as a fraction of revenue (after COGS, payment fees, hosting). */
  grossMargin: rate,
  /** Fraction of accounts lost each month. */
  monthlyChurn: rate,
  /** Expansion revenue per month as a fraction of existing MRR. */
  monthlyExpansion: rate.default(0),
  /** Fully loaded acquisition spend for the period being measured. */
  acquisitionSpend: money,
  /** New customers won with that spend. */
  newCustomers: z.number().int().min(0),
  /** Fixed operating cost per month (salaries, tools, rent). */
  fixedCostsMonthly: money.default(0),
  /** Cash on hand, used for runway. */
  cash: money.default(0),
  /** Current active customers. */
  customers: z.number().int().min(0).default(0),
  /** Cap on modelled customer lifetime, so near-zero churn cannot imply infinite LTV. */
  lifetimeCapMonths: z.number().int().positive().default(120),
})

export type BusinessAssumptions = z.infer<typeof BusinessAssumptions>
export type BusinessAssumptionsInput = z.input<typeof BusinessAssumptions>

export function parseAssumptions(input: unknown): BusinessAssumptions {
  return BusinessAssumptions.parse(input)
}
