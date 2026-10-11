/**
 * Descriptive statistics, the normal and Student-t distributions, and two
 * hypothesis tests commonly needed for experiment analysis (A/B tests).
 *
 * Conventions:
 * - Functions that need data throw `RangeError` on empty input rather than
 *   returning `NaN`, so a silent empty dataset cannot masquerade as a result.
 * - {@link sum} uses Neumaier compensated summation (accurate for long series
 *   of mixed magnitude).
 * - {@link percentile} uses linear interpolation between closest ranks —
 *   Hyndman & Fan type 7, the default in R, NumPy, and Excel's PERCENTILE.INC.
 * - Distribution functions are computed from the regularized incomplete gamma
 *   and beta functions (Numerical Recipes §6.2, §6.4); accuracy is ~1e-12 or
 *   better across normal ranges, ample for p-values.
 *
 * @example
 * ```ts
 * import { mean, percentile, twoProportionZTest, welchTTest } from "@bib/shared/stats"
 *
 * mean([2, 4, 9])                      // 5
 * percentile([1, 2, 3, 4], 50)         // 2.5
 * twoProportionZTest({ successes: 120, trials: 1000 }, { successes: 150, trials: 1000 }).pValue
 * // ≈ 0.0497
 * welchTTest([5.1, 4.9, 5.3, 5.0], [5.6, 5.8, 5.5, 5.9]).pValue // ≈ 0.0025
 * ```
 */

function requireData(values: readonly number[], fn: string, min = 1): void {
  if (values.length < min) {
    throw new RangeError(`${fn}() needs at least ${min} value${min === 1 ? "" : "s"}`)
  }
}

/** Sum with Neumaier compensation. `sum([]) === 0`. */
export function sum(values: readonly number[]): number {
  let total = 0
  let compensation = 0
  for (const v of values) {
    const t = total + v
    compensation += Math.abs(total) >= Math.abs(v) ? total - t + v : v - t + total
    total = t
  }
  return total + compensation
}

/** Arithmetic mean. */
export function mean(values: readonly number[]): number {
  requireData(values, "mean")
  return sum(values) / values.length
}

function sorted(values: readonly number[]): number[] {
  return [...values].sort((a, b) => a - b)
}

function sortedAt(sortedValues: readonly number[], index: number): number {
  const v = sortedValues[index]
  if (v === undefined) throw new RangeError(`index ${index} out of range`)
  return v
}

function quantileSorted(s: readonly number[], q: number): number {
  const pos = (s.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  const a = sortedAt(s, lo)
  return lo === hi ? a : a + (sortedAt(s, hi) - a) * (pos - lo)
}

/** Median (average of the two middle values for even counts). */
export function median(values: readonly number[]): number {
  requireData(values, "median")
  return quantileSorted(sorted(values), 0.5)
}

/**
 * The `p`th percentile, `p` in `[0, 100]`, by linear interpolation (type 7).
 *
 * @example
 * ```ts
 * percentile([10, 20, 30, 40, 50], 90) // 46
 * percentile([10, 20, 30, 40, 50], 0)  // 10
 * ```
 */
export function percentile(values: readonly number[], p: number): number {
  requireData(values, "percentile")
  if (!(p >= 0 && p <= 100)) throw new RangeError(`percentile must be in [0, 100], got ${p}`)
  return quantileSorted(sorted(values), p / 100)
}

/**
 * The `n - 1` cut points dividing the data into `n` equal-probability groups
 * (type 7). `quantiles(xs, 4)` returns the three quartiles.
 */
export function quantiles(values: readonly number[], n = 4): number[] {
  requireData(values, "quantiles")
  if (!Number.isInteger(n) || n < 2) throw new RangeError(`n must be an integer >= 2, got ${n}`)
  const s = sorted(values)
  return Array.from({ length: n - 1 }, (_, i) => quantileSorted(s, (i + 1) / n))
}

/** Population variance (divide by n). */
export function variance(values: readonly number[]): number {
  requireData(values, "variance")
  const m = mean(values)
  return sum(values.map((v) => (v - m) ** 2)) / values.length
}

/** Sample variance (Bessel-corrected, divide by n − 1). */
export function sampleVariance(values: readonly number[]): number {
  requireData(values, "sampleVariance", 2)
  const m = mean(values)
  return sum(values.map((v) => (v - m) ** 2)) / (values.length - 1)
}

/** Population standard deviation. */
export function stdev(values: readonly number[]): number {
  return Math.sqrt(variance(values))
}

/** Sample standard deviation (use when the data is a sample of a larger population). */
export function sampleStdev(values: readonly number[]): number {
  return Math.sqrt(sampleVariance(values))
}

/** One histogram bucket; `[start, end)` except the last, which includes `end`. */
export interface HistogramBin {
  readonly start: number
  readonly end: number
  readonly count: number
}

/**
 * Equal-width histogram. Range defaults to the data's min/max. Values outside
 * an explicit `[min, max]` are ignored. Non-finite values are ignored.
 *
 * @example
 * ```ts
 * histogram([1, 2, 2, 3, 9], { bins: 2 })
 * // [{ start: 1, end: 5, count: 4 }, { start: 5, end: 9, count: 1 }]
 * ```
 */
export function histogram(
  values: readonly number[],
  options: { readonly bins?: number; readonly min?: number; readonly max?: number } = {},
): HistogramBin[] {
  const bins = options.bins ?? 10
  if (!Number.isInteger(bins) || bins < 1) throw new RangeError("bins must be a positive integer")
  const finite = values.filter(Number.isFinite)
  if (finite.length === 0 && (options.min === undefined || options.max === undefined)) return []
  const lo = options.min ?? Math.min(...finite)
  const hi = options.max ?? Math.max(...finite)
  if (!(hi >= lo)) throw new RangeError("max must be >= min")
  const width = hi === lo ? 1 : (hi - lo) / bins
  const counts = new Array<number>(bins).fill(0)
  for (const v of finite) {
    if (v < lo || v > hi) continue
    const idx = Math.min(bins - 1, Math.floor((v - lo) / width))
    counts[idx] = (counts[idx] ?? 0) + 1
  }
  return counts.map((count, i) => ({
    start: lo + i * width,
    end: i === bins - 1 ? Math.max(hi, lo + width) : lo + (i + 1) * width,
    count,
  }))
}

// ---------------------------------------------------------------------------
// Special functions
// ---------------------------------------------------------------------------

const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
  -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
  1.5056327351493116e-7,
]

/** Natural log of the gamma function for `x > 0` (Lanczos, g = 7). */
export function logGamma(x: number): number {
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - logGamma(1 - x)
  const z = x - 1
  let a = LANCZOS[0] ?? 0
  const t = z + 7.5
  for (let i = 1; i < LANCZOS.length; i++) a += (LANCZOS[i] ?? 0) / (z + i)
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a)
}

const EPS = 1e-15
const TINY = 1e-300
const MAX_ITER = 500

/** Regularized upper incomplete gamma Q(a, x) = Γ(a, x) / Γ(a). */
function gammaQ(a: number, x: number): number {
  if (x <= 0) return 1
  const lnPrefix = -x + a * Math.log(x) - logGamma(a)
  if (x < a + 1) {
    // Series for P, then Q = 1 - P.
    let ap = a
    let del = 1 / a
    let total = del
    for (let n = 0; n < MAX_ITER; n++) {
      ap += 1
      del *= x / ap
      total += del
      if (Math.abs(del) < Math.abs(total) * EPS) break
    }
    return 1 - total * Math.exp(lnPrefix)
  }
  // Continued fraction (modified Lentz).
  let b = x + 1 - a
  let c = 1 / TINY
  let d = 1 / b
  let h = d
  for (let i = 1; i < MAX_ITER; i++) {
    const an = -i * (i - a)
    b += 2
    d = an * d + b
    if (Math.abs(d) < TINY) d = TINY
    c = b + an / c
    if (Math.abs(c) < TINY) c = TINY
    d = 1 / d
    const del = d * c
    h *= del
    if (Math.abs(del - 1) < EPS) break
  }
  return Math.exp(lnPrefix) * h
}

/** Complementary error function, erfc(x) = 1 − erf(x). */
export function erfc(x: number): number {
  if (Number.isNaN(x)) return Number.NaN
  return x >= 0 ? gammaQ(0.5, x * x) : 2 - gammaQ(0.5, x * x)
}

/** Error function. */
export function erf(x: number): number {
  return 1 - erfc(x)
}

/** Standard normal CDF Φ((x − mean) / stdev). */
export function normalCdf(x: number, meanValue = 0, sd = 1): number {
  if (!(sd > 0)) throw new RangeError("stdev must be > 0")
  return 0.5 * erfc(-(x - meanValue) / (sd * Math.SQRT2))
}

function betaContinuedFraction(a: number, b: number, x: number): number {
  const qab = a + b
  const qap = a + 1
  const qam = a - 1
  let c = 1
  let d = 1 - (qab * x) / qap
  if (Math.abs(d) < TINY) d = TINY
  d = 1 / d
  let h = d
  for (let m = 1; m <= MAX_ITER; m++) {
    const m2 = 2 * m
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2))
    d = 1 + aa * d
    if (Math.abs(d) < TINY) d = TINY
    c = 1 + aa / c
    if (Math.abs(c) < TINY) c = TINY
    d = 1 / d
    h *= d * c
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2))
    d = 1 + aa * d
    if (Math.abs(d) < TINY) d = TINY
    c = 1 + aa / c
    if (Math.abs(c) < TINY) c = TINY
    d = 1 / d
    const del = d * c
    h *= del
    if (Math.abs(del - 1) < EPS) break
  }
  return h
}

/** Regularized incomplete beta I_x(a, b), for `a, b > 0` and `0 <= x <= 1`. */
export function regularizedIncompleteBeta(x: number, a: number, b: number): number {
  if (!(a > 0 && b > 0)) throw new RangeError("a and b must be > 0")
  if (!(x >= 0 && x <= 1)) throw new RangeError("x must be in [0, 1]")
  if (x === 0 || x === 1) return x
  const lnFront =
    logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x)
  const front = Math.exp(lnFront)
  return x < (a + 1) / (a + b + 2)
    ? (front * betaContinuedFraction(a, b, x)) / a
    : 1 - (front * betaContinuedFraction(b, a, 1 - x)) / b
}

/** Student-t CDF with `df` degrees of freedom (`df > 0`, need not be an integer). */
export function studentTCdf(t: number, df: number): number {
  if (!(df > 0)) throw new RangeError("df must be > 0")
  if (t === Number.POSITIVE_INFINITY) return 1
  if (t === Number.NEGATIVE_INFINITY) return 0
  const tail = 0.5 * regularizedIncompleteBeta(df / (df + t * t), df / 2, 0.5)
  return t > 0 ? 1 - tail : tail
}

/** Two-sided p-value for a t statistic: P(|T| >= |t|). */
function tTwoSided(t: number, df: number): number {
  return regularizedIncompleteBeta(df / (df + t * t), df / 2, 0.5)
}

// ---------------------------------------------------------------------------
// Hypothesis tests
// ---------------------------------------------------------------------------

/** Successes out of trials for one arm of an experiment. */
export interface ProportionSample {
  readonly successes: number
  readonly trials: number
}

/** Result of {@link twoProportionZTest}. */
export interface ProportionTestResult {
  readonly rateA: number
  readonly rateB: number
  /** `rateB − rateA`. */
  readonly difference: number
  readonly z: number
  /** Two-sided p-value. */
  readonly pValue: number
}

function checkArm(label: string, s: ProportionSample): void {
  if (!Number.isInteger(s.trials) || s.trials < 1) {
    throw new RangeError(`arm ${label}: trials must be a positive integer`)
  }
  if (!Number.isInteger(s.successes) || s.successes < 0 || s.successes > s.trials) {
    throw new RangeError(`arm ${label}: successes must be an integer in [0, trials]`)
  }
}

/**
 * Two-sided two-proportion z-test using the pooled standard error — the
 * standard test for "did variant B convert differently from A?". Normal
 * approximation: reliable when each arm has at least ~10 successes and ~10
 * failures. When both arms are 0% or both 100% there is no variance; the
 * result is `z = 0`, `pValue = 1`.
 *
 * @example
 * ```ts
 * const r = twoProportionZTest({ successes: 120, trials: 1000 }, { successes: 150, trials: 1000 })
 * r.difference // 0.03
 * r.z          // ≈ 1.963
 * r.pValue     // ≈ 0.0497
 * ```
 */
export function twoProportionZTest(a: ProportionSample, b: ProportionSample): ProportionTestResult {
  checkArm("A", a)
  checkArm("B", b)
  const rateA = a.successes / a.trials
  const rateB = b.successes / b.trials
  const pooled = (a.successes + b.successes) / (a.trials + b.trials)
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / a.trials + 1 / b.trials))
  const difference = rateB - rateA
  if (se === 0) return { rateA, rateB, difference, z: 0, pValue: 1 }
  const z = difference / se
  return { rateA, rateB, difference, z, pValue: erfc(Math.abs(z) / Math.SQRT2) }
}

/** Result of {@link welchTTest}. */
export interface TTestResult {
  readonly meanA: number
  readonly meanB: number
  /** `meanB − meanA`. */
  readonly difference: number
  readonly t: number
  /** Welch–Satterthwaite degrees of freedom (fractional). */
  readonly df: number
  /** Two-sided p-value. */
  readonly pValue: number
}

/**
 * Welch's unequal-variance t-test (two-sided) for a difference in means. Prefer
 * it over Student's pooled test: it does not assume equal variances and loses
 * almost nothing when they are equal. Each sample needs at least 2 values.
 * If both samples have zero variance the test is undefined: identical means
 * give `pValue = 1`, different means give `pValue = 0`.
 */
export function welchTTest(a: readonly number[], b: readonly number[]): TTestResult {
  requireData(a, "welchTTest (sample A)", 2)
  requireData(b, "welchTTest (sample B)", 2)
  const meanA = mean(a)
  const meanB = mean(b)
  const va = sampleVariance(a) / a.length
  const vb = sampleVariance(b) / b.length
  const difference = meanB - meanA
  const se2 = va + vb
  const naiveDf = a.length + b.length - 2
  if (se2 === 0) {
    const same = difference === 0
    return {
      meanA,
      meanB,
      difference,
      t: same ? 0 : Math.sign(difference) * Number.POSITIVE_INFINITY,
      df: naiveDf,
      pValue: same ? 1 : 0,
    }
  }
  const t = difference / Math.sqrt(se2)
  const df = se2 ** 2 / (va ** 2 / (a.length - 1) + vb ** 2 / (b.length - 1))
  return { meanA, meanB, difference, t, df, pValue: tTwoSided(t, df) }
}
