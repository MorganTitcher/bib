import { type Projection, project, type Summary } from "./engine.ts"
import { getBand, withBandPoints } from "./paths.ts"
import type { FinanceModel } from "./schema.ts"

/**
 * A copy of `model` with scenario `id`'s overrides applied. `"low"` and `"high"`
 * move a band to its own bound; a number moves its point (clamped to the band's
 * hard limits). Throws when the scenario or a path is unknown.
 */
export function applyScenario(model: FinanceModel, id: string): FinanceModel {
  const scenario = model.scenarios.find((s) => s.id === id)
  if (scenario === undefined) throw new RangeError(`unknown scenario: ${id}`)
  const points: Record<string, number> = {}
  for (const [path, value] of Object.entries(scenario.overrides)) {
    if (typeof value === "number") {
      points[path] = value
      continue
    }
    const found = getBand(model, path)
    if (found === undefined) throw new RangeError(`unknown band path: ${path}`)
    points[path] = value === "low" ? found.low : found.high
  }
  return withBandPoints(model, points)
}

export interface ScenarioHeadline {
  endingCash: number
  endingMrr: number
  endingCustomers: number
  totalNetRevenue: number
  totalEbitda: number
  minCash: number
  runwayMonths: number | null
  cashOutMonth: string | null
  ebitdaBreakEven: string | null
}

export interface ScenarioResult {
  id: string
  name: string
  headline: ScenarioHeadline
  /** Scenario minus base for each numeric headline (`null` when either side is undefined). */
  delta: Record<keyof ScenarioHeadline, number | null>
  summary: Summary
  warnings: string[]
}

export interface ScenarioComparison {
  base: { headline: ScenarioHeadline; summary: Summary; warnings: string[] }
  scenarios: ScenarioResult[]
}

export function headline(projection: Projection): ScenarioHeadline {
  const { summary } = projection
  return {
    endingCash: summary.ending.cash,
    endingMrr: summary.ending.mrr,
    endingCustomers: summary.ending.customers,
    totalNetRevenue: summary.totals.netRevenue,
    totalEbitda: summary.totals.ebitda,
    minCash: summary.minCash.value,
    runwayMonths: summary.runway.months,
    cashOutMonth: summary.cashOutMonth?.label ?? null,
    ebitdaBreakEven: summary.ebitdaBreakEven?.label ?? null,
  }
}

function diff(
  a: ScenarioHeadline,
  b: ScenarioHeadline,
): Record<keyof ScenarioHeadline, number | null> {
  const out = {} as Record<keyof ScenarioHeadline, number | null>
  for (const key of Object.keys(a) as (keyof ScenarioHeadline)[]) {
    const x = a[key]
    const y = b[key]
    out[key] = typeof x === "number" && typeof y === "number" ? x - y : null
  }
  return out
}

/** Project the base model and each scenario (default: all), with deltas against the base. */
export function compareScenarios(model: FinanceModel, ids?: readonly string[]): ScenarioComparison {
  const baseProjection = project(model)
  const base = headline(baseProjection)
  const chosen = ids ?? model.scenarios.map((s) => s.id)
  return {
    base: { headline: base, summary: baseProjection.summary, warnings: baseProjection.warnings },
    scenarios: chosen.map((id) => {
      const projection = project(applyScenario(model, id))
      const h = headline(projection)
      return {
        id,
        name: model.scenarios.find((s) => s.id === id)?.name ?? id,
        headline: h,
        delta: diff(h, base),
        summary: projection.summary,
        warnings: projection.warnings,
      }
    }),
  }
}
