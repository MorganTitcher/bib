/**
 * Divide, returning null when the result is not a finite number.
 *
 * Unit-economics ratios are routinely undefined (zero churn, zero spend, zero
 * customers). `null` survives JSON serialisation; `Infinity` and `NaN` do not.
 */
export function ratio(numerator: number, denominator: number): number | null {
  const value = numerator / denominator
  return Number.isFinite(value) ? value : null
}
