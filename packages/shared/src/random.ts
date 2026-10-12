/**
 * Seeded, reproducible pseudo-random numbers for simulations, Monte Carlo
 * models, fixtures, and snapshot-stable rendering.
 *
 * The generator is mulberry32: a 32-bit state, period 2^32, fast, and good
 * enough statistically for simulation. It is NOT cryptographically secure —
 * use `@bib/shared/ids` for tokens and secrets.
 *
 * @example
 * ```ts
 * import { createRng } from "@bib/shared/random"
 *
 * const rng = createRng(42)
 * rng.next()                 // same value every run for seed 42
 * rng.int(1, 6)              // die roll, inclusive
 * rng.normal(100, 15)        // Gaussian
 * rng.lognormal(0, 0.5)      // positive, right-skewed (e.g. durations, deal sizes)
 * rng.triangular(10, 20, 14) // three-point estimate (min, max, mode)
 * rng.shuffle([1, 2, 3, 4])  // new array, Fisher–Yates
 * ```
 */
import { fnv1a32 } from "./hashing.ts"

/** A seeded random source. All methods advance the shared state. */
export interface Rng {
  /** The seed this generator started from. */
  readonly seed: number
  /** Uniform float in `[0, 1)`. */
  next(): number
  /** Uniform float in `[min, max)`. */
  uniform(min: number, max: number): number
  /** Uniform integer in `[min, max]` (both inclusive, both integers). */
  int(min: number, max: number): number
  /** True with probability `p` (clamped to `[0, 1]`). */
  bool(p?: number): boolean
  /** Gaussian sample (Box–Muller). */
  normal(mean?: number, stdev?: number): number
  /** `exp(normal(mu, sigma))`: `mu`/`sigma` are the mean/stdev of the underlying normal. */
  lognormal(mu?: number, sigma?: number): number
  /** Triangular distribution on `[min, max]` peaking at `mode`. */
  triangular(min: number, max: number, mode: number): number
  /** One uniformly chosen element. Throws on an empty array. */
  pick<T>(items: readonly T[]): T
  /** A shuffled copy (Fisher–Yates); the input is not mutated. */
  shuffle<T>(items: readonly T[]): T[]
  /** A new generator seeded from this one — independent stream, reproducible. */
  fork(): Rng
}

/** Derive a 32-bit seed from a string (FNV-1a), so seeds can be readable names. */
export function seedFromString(text: string): number {
  return fnv1a32(text)
}

/** The raw mulberry32 step function for callers who only need `() => number`. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

/**
 * Create a seeded generator. A string seed is hashed with {@link seedFromString};
 * a number is truncated to 32 bits.
 */
export function createRng(seed: number | string): Rng {
  const numericSeed = typeof seed === "string" ? seedFromString(seed) : seed >>> 0
  const next = mulberry32(numericSeed)
  let spare: number | undefined

  const gaussian = (): number => {
    if (spare !== undefined) {
      const value = spare
      spare = undefined
      return value
    }
    // 1 - next() is in (0, 1], so log never sees 0.
    const u1 = 1 - next()
    const u2 = next()
    const radius = Math.sqrt(-2 * Math.log(u1))
    spare = radius * Math.sin(2 * Math.PI * u2)
    return radius * Math.cos(2 * Math.PI * u2)
  }

  const rng: Rng = {
    seed: numericSeed,
    next,
    uniform(min, max) {
      return min + (max - min) * next()
    },
    int(min, max) {
      if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
        throw new RangeError(`int() needs integers with min <= max, got ${min}, ${max}`)
      }
      return min + Math.floor(next() * (max - min + 1))
    },
    bool(p = 0.5) {
      return next() < Math.min(1, Math.max(0, p))
    },
    normal(mean = 0, stdev = 1) {
      if (stdev < 0) throw new RangeError("stdev must be >= 0")
      return mean + stdev * gaussian()
    },
    lognormal(mu = 0, sigma = 1) {
      if (sigma < 0) throw new RangeError("sigma must be >= 0")
      return Math.exp(mu + sigma * gaussian())
    },
    triangular(min, max, mode) {
      if (!(min <= mode && mode <= max)) {
        throw new RangeError(`triangular() needs min <= mode <= max, got ${min}, ${mode}, ${max}`)
      }
      if (min === max) return min
      const u = next()
      const cut = (mode - min) / (max - min)
      return u < cut
        ? min + Math.sqrt(u * (max - min) * (mode - min))
        : max - Math.sqrt((1 - u) * (max - min) * (max - mode))
    },
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) throw new RangeError("pick() from an empty array")
      const index = Math.floor(next() * items.length)
      // A one-element slice yields the element typed as T (an indexed read would be
      // T | undefined, and T itself may legitimately include undefined).
      for (const item of items.slice(index, index + 1)) return item
      throw new RangeError("unreachable: index out of bounds")
    },
    shuffle<T>(items: readonly T[]): T[] {
      // Swap boxes rather than raw values so the element type stays exactly T.
      const boxes = items.map((item) => ({ item }))
      for (let i = boxes.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1))
        const a = boxes[i]
        const b = boxes[j]
        if (a && b) {
          boxes[i] = b
          boxes[j] = a
        }
      }
      return boxes.map((box) => box.item)
    },
    fork() {
      return createRng(Math.floor(next() * 4_294_967_296))
    },
  }
  return rng
}
