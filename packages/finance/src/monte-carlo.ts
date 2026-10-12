import { createRng } from "@bib/shared/random"
import { mean, percentile } from "@bib/shared/stats"
import { sampleBand } from "./band.ts"
import { project } from "./engine.ts"
import { OUTCOMES, type Outcome, outcomeValue } from "./metrics.ts"
import { listBands, withBandPoints } from "./paths.ts"
import type { FinanceModel } from "./schema.ts"

export interface MonteCarloOptions {
  /** Number of simulated runs. Default 500. */
  runs?: number
  /** Same seed, same model, same result. Default `"bib-finance"`. */
  seed?: number | string
  /** Outcomes to summarize. Default: all of {@link OUTCOMES}. */
  outcomes?: readonly Outcome[]
}

export interface Distribution {
  p10: number | null
  p50: number | null
  p90: number | null
  mean: number | null
  /** Share of runs where the outcome was undefined (runway when cash never runs out). */
  nullShare: number
}

export interface MonthBand {
  index: number
  label: string
  p10: number
  p50: number
  p90: number
}

export interface MonteCarloResult {
  runs: number
  seed: number | string
  /** Band paths that were sampled (bands with a range). */
  sampled: string[]
  outcomes: Partial<Record<Outcome, Distribution>>
  /** Monthly cash and MRR fan charts. */
  cash: MonthBand[]
  mrr: MonthBand[]
  /** Share of runs where cash goes below zero inside the horizon. */
  probabilityCashOut: number
}

function distribution(values: readonly (number | null)[]): Distribution {
  const defined = values.filter((v): v is number => v !== null && Number.isFinite(v))
  const nullShare = values.length === 0 ? 0 : (values.length - defined.length) / values.length
  if (defined.length === 0) return { p10: null, p50: null, p90: null, mean: null, nullShare }
  return {
    p10: percentile(defined, 10),
    p50: percentile(defined, 50),
    p90: percentile(defined, 90),
    mean: mean(defined),
    nullShare,
  }
}

/**
 * Sample every band with a range (triangular on `low`..`high`, peaking at
 * `point`), project, and summarize the spread of outcomes as P10/P50/P90.
 *
 * Bands are sampled independently: correlated assumptions (higher spend and
 * higher CAC together) are not modeled.
 */
export function monteCarlo(model: FinanceModel, options: MonteCarloOptions = {}): MonteCarloResult {
  const runs = options.runs ?? 500
  if (!Number.isInteger(runs) || runs < 1) throw new RangeError("runs must be a positive integer")
  const seed = options.seed ?? "bib-finance"
  const outcomes = options.outcomes ?? OUTCOMES
  const rng = createRng(seed)
  const uncertain = listBands(model).filter(({ band }) => band.high > band.low)

  const values = new Map<Outcome, (number | null)[]>(outcomes.map((o) => [o, []]))
  const horizon = model.meta.horizonMonths
  const cashByMonth: number[][] = Array.from({ length: horizon }, () => [])
  const mrrByMonth: number[][] = Array.from({ length: horizon }, () => [])
  const labels: string[] = []
  let cashOuts = 0

  for (let run = 0; run < runs; run++) {
    const points: Record<string, number> = {}
    for (const { path, band } of uncertain) points[path] = sampleBand(band, rng)
    const projection = project(uncertain.length > 0 ? withBandPoints(model, points) : model)
    for (const outcome of outcomes) values.get(outcome)?.push(outcomeValue(projection, outcome))
    projection.months.forEach((row, i) => {
      cashByMonth[i]?.push(row.balance.cash)
      mrrByMonth[i]?.push(row.mrr.ending)
      if (run === 0) labels[i] = row.label
    })
    if (projection.summary.cashOutMonth !== null) cashOuts++
  }

  const fan = (series: number[][]): MonthBand[] =>
    series.map((column, index) => ({
      index,
      label: labels[index] ?? String(index),
      p10: percentile(column, 10),
      p50: percentile(column, 50),
      p90: percentile(column, 90),
    }))

  const summary: Partial<Record<Outcome, Distribution>> = {}
  for (const outcome of outcomes) summary[outcome] = distribution(values.get(outcome) ?? [])
  return {
    runs,
    seed,
    sampled: uncertain.map((entry) => entry.path),
    outcomes: summary,
    cash: fan(cashByMonth),
    mrr: fan(mrrByMonth),
    probabilityCashOut: cashOuts / runs,
  }
}
