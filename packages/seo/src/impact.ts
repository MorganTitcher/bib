/**
 * Before/after impact checks for SEO changes ("did the title rewrite move
 * CTR?"). The statistics come from `@bib/shared/stats`; this module adds the
 * SEO framing: CTR as clicks/impressions, splitting a daily series around a
 * change date, rolling averages, and a verdict that knows whether higher or
 * lower is better (position: lower is better).
 *
 * These are observational comparisons, not experiments. Seasonality, ranking
 * updates and other deploys confound them; treat a significant result as a
 * lead to investigate, not proof of cause.
 */

import { mean, twoProportionZTest, welchTTest } from "@bib/shared/stats"
import { type DateInput, toInstant } from "./internal.ts"

export interface CtrSample {
  readonly clicks: number
  readonly impressions: number
}

export type Direction = "higher-is-better" | "lower-is-better"
export type Verdict = "improved" | "regressed" | "no-significant-change" | "insufficient-data"

export interface ImpactOptions {
  /** Significance level, default 0.05. */
  readonly alpha?: number
  readonly direction?: Direction
}

export interface ImpactResult {
  readonly before: number
  readonly after: number
  /** `after - before`. */
  readonly change: number
  /** `change / before`, or `undefined` when `before` is 0. */
  readonly relativeChange?: number
  readonly statistic: number
  readonly pValue: number
  readonly verdict: Verdict
  /** Why the verdict is `insufficient-data`, when it is. */
  readonly note?: string
}

function checkAlpha(alpha: number): void {
  if (!(alpha > 0 && alpha < 1)) throw new RangeError("alpha must be in (0, 1)")
}

/** Turn a difference and p-value into a verdict. */
export function impactVerdict(
  change: number,
  pValue: number,
  options: ImpactOptions = {},
): Verdict {
  const alpha = options.alpha ?? 0.05
  checkAlpha(alpha)
  if (!(pValue < alpha) || change === 0) return "no-significant-change"
  const better = options.direction === "lower-is-better" ? change < 0 : change > 0
  return better ? "improved" : "regressed"
}

function relative(before: number, change: number): { relativeChange?: number } {
  return before === 0 ? {} : { relativeChange: change / before }
}

/**
 * Two-proportion z-test on CTR. The normal approximation needs roughly 10+
 * clicks and 10+ non-clicks in each period; below that the verdict is
 * `insufficient-data` (the statistic is still reported).
 */
export function compareCtr(
  before: CtrSample,
  after: CtrSample,
  options: ImpactOptions = {},
): ImpactResult {
  const r = twoProportionZTest(
    { successes: before.clicks, trials: before.impressions },
    { successes: after.clicks, trials: after.impressions },
  )
  const small = [before, after].some((s) => s.clicks < 10 || s.impressions - s.clicks < 10)
  const base = {
    before: r.rateA,
    after: r.rateB,
    change: r.difference,
    ...relative(r.rateA, r.difference),
    statistic: r.z,
    pValue: r.pValue,
  }
  if (small)
    return {
      ...base,
      verdict: "insufficient-data",
      note: "need at least 10 clicks and 10 non-clicks per period",
    }
  return { ...base, verdict: impactVerdict(r.difference, r.pValue, options) }
}

/**
 * Welch's t-test on two samples of daily values (clicks per day, average
 * position per day, ...). Fewer than `minDays` (default 7) values per side
 * gives `insufficient-data`; fewer than 2 throws (shared's precondition).
 */
export function compareDailyValues(
  before: readonly number[],
  after: readonly number[],
  options: ImpactOptions & { readonly minDays?: number } = {},
): ImpactResult {
  const r = welchTTest(before, after)
  const minDays = options.minDays ?? 7
  const base = {
    before: r.meanA,
    after: r.meanB,
    change: r.difference,
    ...relative(r.meanA, r.difference),
    statistic: r.t,
    pValue: r.pValue,
  }
  if (before.length < minDays || after.length < minDays) {
    return {
      ...base,
      verdict: "insufficient-data",
      note: `need at least ${minDays} days on each side`,
    }
  }
  return { ...base, verdict: impactVerdict(r.difference, r.pValue, options) }
}

export interface DailyPoint {
  /** `YYYY-MM-DD` or any date input; compared by UTC day. */
  readonly date: DateInput
  readonly value: number
}

/**
 * Split a daily series into the `windowDays` before and after `changeDate`.
 * The change day itself is excluded from both sides (it is a partial day).
 * Non-finite values are dropped.
 */
export function splitAroundChange(
  series: readonly DailyPoint[],
  changeDate: DateInput,
  windowDays: number,
): { readonly before: number[]; readonly after: number[] } {
  if (!Number.isInteger(windowDays) || windowDays < 1)
    throw new RangeError("windowDays must be a positive integer")
  const DAY = 86_400_000
  const pivot = Math.floor(toInstant(changeDate, "changeDate").getTime() / DAY)
  const before: number[] = []
  const after: number[] = []
  for (const p of series) {
    if (!Number.isFinite(p.value)) continue
    const day = Math.floor(toInstant(p.date, "date").getTime() / DAY)
    const offset = day - pivot
    if (offset < 0 && offset >= -windowDays) before.push(p.value)
    else if (offset > 0 && offset <= windowDays) after.push(p.value)
  }
  return { before, after }
}

/**
 * Trailing rolling average. The first `window - 1` positions average whatever
 * values exist so far (so the output has the same length as the input).
 */
export function rollingAverage(values: readonly number[], window: number): number[] {
  if (!Number.isInteger(window) || window < 1)
    throw new RangeError("window must be a positive integer")
  const out: number[] = []
  for (let i = 0; i < values.length; i++)
    out.push(mean(values.slice(Math.max(0, i - window + 1), i + 1)))
  return out
}
