import { type BusinessAssumptions, parseAssumptions } from "./assumptions.ts"
import { type UnitEconomicsReport, unitEconomics } from "./unit-economics.ts"

type NumericKey = {
  [K in keyof BusinessAssumptions]: BusinessAssumptions[K] extends number ? K : never
}[keyof BusinessAssumptions]

export interface SensitivityRow {
  field: NumericKey
  multiplier: number
  value: number
  report: UnitEconomicsReport
}

/**
 * Re-run unit economics with one field scaled by each multiplier.
 *
 * Scaled values are re-validated, so a multiplier that pushes a rate above 1 or
 * an integer field off-integer is rounded or clamped by the schema rather than
 * silently producing an impossible scenario.
 */
export function sensitivity(
  base: BusinessAssumptions,
  field: NumericKey,
  multipliers: readonly number[] = [0.5, 0.75, 1, 1.25, 1.5],
): SensitivityRow[] {
  return multipliers.map((multiplier) => {
    const raw = base[field] * multiplier
    const value = isIntegerField(field) ? Math.round(raw) : raw
    const clamped = isRateField(field) ? Math.min(value, 1) : value
    const scenario = parseAssumptions({ ...base, [field]: clamped })
    return { field, multiplier, value: clamped, report: unitEconomics(scenario) }
  })
}

const INTEGER_FIELDS: ReadonlySet<NumericKey> = new Set([
  "newCustomers",
  "customers",
  "lifetimeCapMonths",
])
const RATE_FIELDS: ReadonlySet<NumericKey> = new Set([
  "grossMargin",
  "monthlyChurn",
  "monthlyExpansion",
])

function isIntegerField(field: NumericKey): boolean {
  return INTEGER_FIELDS.has(field)
}

function isRateField(field: NumericKey): boolean {
  return RATE_FIELDS.has(field)
}
