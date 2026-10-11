import { project } from "./engine.ts"
import { type OutcomeSelector, outcomeLabel, selectOutcome } from "./metrics.ts"
import { getBand, listBands, withBandPoints } from "./paths.ts"
import type { FinanceModel } from "./schema.ts"

export interface TornadoOptions {
  /** What to measure. Default `"endingCash"`. */
  outcome?: OutcomeSelector
  /**
   * `pct` (default) moves each input `±pct` around its point. `band` moves it to
   * its own `low` and `high`, so only inputs with a range take part.
   */
  mode?: "pct" | "band"
  /** Fractional move for `pct` mode. Default `0.2` (±20%). */
  pct?: number
  /** Only these band paths. Default: every band in the model. */
  paths?: readonly string[]
  /** Keep the top N rows. Default: all. */
  limit?: number
}

export interface TornadoRow {
  path: string
  lowInput: number
  highInput: number
  /** Outcome with the input at `lowInput`. */
  lowValue: number | null
  highValue: number | null
  /** `|highValue - lowValue|`; `null` when either side is undefined. */
  swing: number | null
}

export interface Tornado {
  outcome: string
  mode: "pct" | "band"
  baseValue: number | null
  rows: TornadoRow[]
}

/**
 * One-at-a-time sensitivity: move each input to a low and a high value, re-run
 * the projection, and rank inputs by how much the outcome swings.
 *
 * In `pct` mode inputs whose point is 0 are skipped (±20% of nothing is
 * nothing); in `band` mode, inputs with no range are skipped. Moves are clamped
 * to each band's hard limits, so a 0.95 rate moved +20% stops at 1.
 */
export function tornado(model: FinanceModel, options: TornadoOptions = {}): Tornado {
  const outcome = options.outcome ?? "endingCash"
  const mode = options.mode ?? "pct"
  const pct = options.pct ?? 0.2
  if (!(pct > 0)) throw new RangeError("pct must be greater than 0")
  const wanted = options.paths === undefined ? undefined : new Set(options.paths)
  const baseValue = selectOutcome(project(model), outcome)

  const rows: TornadoRow[] = []
  for (const { path, band } of listBands(model)) {
    if (wanted !== undefined && !wanted.has(path)) continue
    let lowInput: number
    let highInput: number
    if (mode === "pct") {
      if (band.point === 0) continue
      lowInput = band.point * (1 - pct)
      highInput = band.point * (1 + pct)
    } else {
      if (band.high <= band.low) continue
      lowInput = band.low
      highInput = band.high
    }
    const lowModel = withBandPoints(model, { [path]: lowInput })
    const highModel = withBandPoints(model, { [path]: highInput })
    const lowValue = selectOutcome(project(lowModel), outcome)
    const highValue = selectOutcome(project(highModel), outcome)
    rows.push({
      path,
      // Report the inputs actually used, after clamping to the band's limits.
      lowInput: getBand(lowModel, path)?.point ?? lowInput,
      highInput: getBand(highModel, path)?.point ?? highInput,
      lowValue,
      highValue,
      swing: lowValue === null || highValue === null ? null : Math.abs(highValue - lowValue),
    })
  }
  rows.sort((a, b) => {
    if (a.swing === null && b.swing === null) return 0
    if (a.swing === null) return 1
    if (b.swing === null) return -1
    return b.swing - a.swing
  })
  return {
    outcome: outcomeLabel(outcome),
    mode,
    baseValue,
    rows: options.limit === undefined ? rows : rows.slice(0, options.limit),
  }
}
