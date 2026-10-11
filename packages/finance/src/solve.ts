import { err, ok, type Result } from "@bib/shared/result"
import { type MonthPointer, type Projection, project } from "./engine.ts"
import { type OutcomeSelector, selectOutcome } from "./metrics.ts"
import { getBand, setBandPoint } from "./paths.ts"
import type { FinanceModel } from "./schema.ts"

export interface BacksolveOptions {
  /** Band path to solve for, e.g. `"channels.0.spend"`. */
  path: string
  outcome: OutcomeSelector
  target: number
  /** Search bounds. Default: the band's own `low`..`high`. */
  lo?: number
  hi?: number
  /** Stop when the outcome is within this of the target. Default 1% of |target| or 1. */
  tolerance?: number
  maxIterations?: number
}

export interface BacksolveResult {
  path: string
  value: number
  outcomeValue: number
  iterations: number
  model: FinanceModel
}

/**
 * Find the input value that makes `outcome` hit `target`, by bisection. The
 * outcome must move in one direction across `lo..hi` and the bounds must
 * bracket the target; otherwise an error explains why.
 */
export function backsolve(
  model: FinanceModel,
  options: BacksolveOptions,
): Result<BacksolveResult, string> {
  const band = getBand(model, options.path)
  if (band === undefined) return err(`unknown band path: ${options.path}`)
  let lo = options.lo ?? band.low
  let hi = options.hi ?? band.high
  if (!(hi > lo)) return err(`search bounds are empty: lo ${lo}, hi ${hi}`)
  const tolerance = options.tolerance ?? Math.max(1, Math.abs(options.target) * 0.01)
  const maxIterations = options.maxIterations ?? 60
  const evaluate = (value: number) => {
    const next = setBandPoint(model, options.path, value)
    return { model: next, value: selectOutcome(project(next), options.outcome) }
  }
  const low = evaluate(lo)
  const high = evaluate(hi)
  if (low.value === null || high.value === null) {
    return err("the outcome is undefined at a search bound")
  }
  const fLo = low.value - options.target
  const fHi = high.value - options.target
  if (Math.abs(fLo) <= tolerance) {
    return ok({
      path: options.path,
      value: lo,
      outcomeValue: low.value,
      iterations: 0,
      model: low.model,
    })
  }
  if (Math.abs(fHi) <= tolerance) {
    return ok({
      path: options.path,
      value: hi,
      outcomeValue: high.value,
      iterations: 0,
      model: high.model,
    })
  }
  if (Math.sign(fLo) === Math.sign(fHi)) {
    return err(
      `the target ${options.target} is not between ${low.value} (at ${lo}) and ${high.value} (at ${hi}); widen lo/hi`,
    )
  }
  let signLo = Math.sign(fLo)
  for (let i = 1; i <= maxIterations; i++) {
    const mid = (lo + hi) / 2
    const at = evaluate(mid)
    if (at.value === null) return err(`the outcome is undefined at ${mid}`)
    const f = at.value - options.target
    if (Math.abs(f) <= tolerance || hi - lo < 1e-9) {
      return ok({
        path: options.path,
        value: mid,
        outcomeValue: at.value,
        iterations: i,
        model: at.model,
      })
    }
    if (Math.sign(f) === signLo) {
      lo = mid
      signLo = Math.sign(f)
    } else hi = mid
  }
  return err(`no solution within ${maxIterations} iterations`)
}

export interface BreakEven {
  ebitda: MonthPointer | null
  cashFlow: MonthPointer | null
  /** First month net income is >= 0 and stays there. */
  netIncome: MonthPointer | null
}

/** Break-even months from a projection. */
export function breakEven(projection: Projection): BreakEven {
  let netIncome: MonthPointer | null = null
  for (let i = projection.months.length - 1; i >= 0; i--) {
    const row = projection.months[i]
    if (row === undefined || row.netIncome < 0) break
    netIncome = { index: row.index, label: row.label }
  }
  return {
    ebitda: projection.summary.ebitdaBreakEven,
    cashFlow: projection.summary.cashFlowBreakEven,
    netIncome,
  }
}
