import { type MonthRow, type Projection, project } from "./engine.ts"
import { resolveMonth } from "./months.ts"
import type { FinanceModel, Metric } from "./schema.ts"

/** Read a metric from a projected month. */
export function metricValue(row: MonthRow, metric: Metric): number {
  switch (metric) {
    case "netRevenue":
      return row.revenue.net
    case "mrr":
      return row.mrr.ending
    case "newCustomers":
      return row.customers.new
    case "activeCustomers":
      return row.customers.active
    case "grossProfit":
      return row.grossProfit
    case "opex":
      return row.opex.total
    case "ebitda":
      return row.ebitda
    case "netIncome":
      return row.netIncome
    case "cash":
      return row.balance.cash
    case "burn":
      return row.burn
  }
}

export interface VariancePoint {
  month: string
  actual: number
  projected: number
  /** `projected - actual`. */
  error: number
  /** `|error| / |actual|`; `null` when the actual is 0. */
  pctError: number | null
  withinTolerance: boolean | null
}

export interface MetricVariance {
  metric: Metric
  points: VariancePoint[]
  /** Mean absolute percentage error over points with a non-zero actual. */
  mape: number | null
  /** Share of scored points whose percentage error is within the tolerance. */
  withinTolerance: number | null
  /** Mean signed percentage error: positive means the model runs high. */
  bias: number | null
  /** Points skipped from MAPE because the actual was 0. */
  skippedZero: number
}

export interface VarianceReport {
  tolerance: number
  metrics: MetricVariance[]
  /** Actuals outside the projection horizon, ignored. */
  outsideHorizon: number
}

/**
 * Compare `model.actuals` with the projection. Percentage errors divide by the
 * actual, so an actual of 0 cannot be scored and is counted in `skippedZero`.
 */
export function varianceVsActuals(
  model: FinanceModel,
  projection: Projection = project(model),
  options: { tolerance?: number } = {},
): VarianceReport {
  const tolerance = options.tolerance ?? 0.1
  if (!(tolerance >= 0)) throw new RangeError("tolerance must be >= 0")
  const byMetric = new Map<Metric, VariancePoint[]>()
  let outsideHorizon = 0
  for (const actual of model.actuals) {
    const index = resolveMonth(actual.month, model.meta.startMonth)
    const row = projection.months[index]
    if (row === undefined) {
      outsideHorizon++
      continue
    }
    const projected = metricValue(row, actual.metric)
    const error = projected - actual.value
    const pctError = actual.value === 0 ? null : Math.abs(error) / Math.abs(actual.value)
    const list = byMetric.get(actual.metric) ?? []
    list.push({
      month: row.label,
      actual: actual.value,
      projected,
      error,
      pctError,
      withinTolerance: pctError === null ? null : pctError <= tolerance,
    })
    byMetric.set(actual.metric, list)
  }
  const metrics: MetricVariance[] = []
  for (const [metric, points] of byMetric) {
    const scored = points.filter((p) => p.pctError !== null)
    const n = scored.length
    const mape = n === 0 ? null : scored.reduce((s, p) => s + (p.pctError ?? 0), 0) / n
    const within = n === 0 ? null : scored.filter((p) => p.withinTolerance === true).length / n
    const bias = n === 0 ? null : scored.reduce((s, p) => s + p.error / Math.abs(p.actual), 0) / n
    metrics.push({
      metric,
      points,
      mape,
      withinTolerance: within,
      bias,
      skippedZero: points.length - n,
    })
  }
  return { tolerance, metrics, outsideHorizon }
}
