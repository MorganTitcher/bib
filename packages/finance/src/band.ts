import { isRecord } from "@bib/shared/guards"
import type { Rng } from "@bib/shared/random"
import { z } from "zod"

/**
 * How much an assumption should be trusted.
 *
 * - `hypothesis`: a guess or a plan. Nothing has been measured yet.
 * - `benchmark`: borrowed from someone else's data (an industry report, a peer).
 * - `observed`: measured in this business.
 */
export const EVIDENCE_LEVELS = ["hypothesis", "benchmark", "observed"] as const
export type Evidence = (typeof EVIDENCE_LEVELS)[number]

export const ProvenanceSchema = z.object({
  /** Where the number came from: a person, a report, a dashboard, a contract. */
  source: z.string().min(1),
  evidence: z.enum(EVIDENCE_LEVELS),
  /** When the number was true, as an ISO date or `YYYY-MM`. */
  asOf: z.string().optional(),
  note: z.string().optional(),
})
export type Provenance = z.infer<typeof ProvenanceSchema>

/**
 * An uncertain assumption: a point estimate plus a plausible range.
 *
 * The projection always runs on `point`. `low` and `high` drive the tornado
 * (`mode: "band"`) and Monte Carlo (triangular `low`..`high` peaking at
 * `point`). `min` and `max` are hard limits set by the schema (a rate cannot
 * exceed 1), used to clamp scaled or sampled values.
 */
export interface Band {
  low: number
  point: number
  high: number
  min?: number
  max?: number
  provenance?: Provenance
}

/** What a band looks like in JSON: a bare number (no uncertainty) or the full object. */
export type BandInput =
  | number
  | { low: number; point: number; high: number; provenance?: Provenance | undefined }

export interface BandLimits {
  min?: number
  max?: number
}

const BandObject = z.object({
  low: z.number(),
  point: z.number(),
  high: z.number(),
  provenance: ProvenanceSchema.optional(),
})

/**
 * Zod schema for a band. A bare number is shorthand for `{ low: n, point: n, high: n }`.
 * Rejects `low > point`, `point > high`, non-finite values, and values outside `limits`.
 */
export function bandSchema(limits: BandLimits = {}) {
  return z.union([z.number(), BandObject]).transform((value, ctx): Band => {
    const raw = typeof value === "number" ? { low: value, point: value, high: value } : value
    const { low, point, high } = raw
    if (![low, point, high].every(Number.isFinite)) {
      ctx.addIssue({ code: "custom", message: "band values must be finite numbers" })
      return z.NEVER
    }
    if (low > point || point > high) {
      ctx.addIssue({
        code: "custom",
        message: `band must satisfy low <= point <= high (got ${low}, ${point}, ${high})`,
      })
      return z.NEVER
    }
    if (limits.min !== undefined && low < limits.min) {
      ctx.addIssue({
        code: "custom",
        message: `band low ${low} is below the minimum ${limits.min}`,
      })
      return z.NEVER
    }
    if (limits.max !== undefined && high > limits.max) {
      ctx.addIssue({
        code: "custom",
        message: `band high ${high} exceeds the maximum ${limits.max}`,
      })
      return z.NEVER
    }
    const out: Band = { low, point, high }
    if (limits.min !== undefined) out.min = limits.min
    if (limits.max !== undefined) out.max = limits.max
    if (raw.provenance !== undefined) out.provenance = raw.provenance
    return out
  })
}

/** A non-negative amount of money, in major units of the model currency. */
export const moneyBand = () => bandSchema({ min: 0 })
/** A fraction between 0 and 1 (0.03 = 3%). */
export const rateBand = () => bandSchema({ min: 0, max: 1 })
/** A growth rate per month: may be negative, but never below -100%. */
export const growthBand = () => bandSchema({ min: -1 })
/** Basis points, 0..10000 (250 = 2.5%). */
export const bpsBand = () => bandSchema({ min: 0, max: 10_000 })
/** A non-negative quantity (units, hours, customers). */
export const countBand = () => bandSchema({ min: 0 })

/**
 * Build a band in code.
 *
 * ```ts
 * band(49)                                  // { low: 49, point: 49, high: 49 }
 * band(39, 49, 59)                          // a range
 * band(0.02, 0.03, 0.05, { source: "billing export", evidence: "observed" })
 * ```
 */
export function band(point: number): Band
export function band(low: number, point: number, high: number, provenance?: Provenance): Band
export function band(a: number, b?: number, c?: number, provenance?: Provenance): Band {
  if (b === undefined || c === undefined) return { low: a, point: a, high: a }
  if (a > b || b > c)
    throw new RangeError(`band must satisfy low <= point <= high (${a}, ${b}, ${c})`)
  const out: Band = { low: a, point: b, high: c }
  if (provenance !== undefined) out.provenance = provenance
  return out
}

/** Clamp `value` into a band's hard limits. */
export function clampToLimits(b: Band, value: number): number {
  let v = value
  if (b.min !== undefined && v < b.min) v = b.min
  if (b.max !== undefined && v > b.max) v = b.max
  return v
}

/**
 * Return a copy of `b` whose point is `value` (clamped to the hard limits).
 * `low`/`high` widen if needed so the band stays ordered.
 */
export function withPoint(b: Band, value: number): Band {
  const point = clampToLimits(b, value)
  return { ...b, point, low: Math.min(b.low, point), high: Math.max(b.high, point) }
}

/**
 * Draw one value from a band: triangular on `low`..`high` peaking at `point`.
 * A band with no width returns its point without consuming randomness.
 */
export function sampleBand(b: Band, rng: Rng): number {
  if (b.high <= b.low) return b.point
  return clampToLimits(b, rng.triangular(b.low, b.high, b.point))
}

/** True when the band carries a real range rather than a single number. */
export function isUncertain(b: Band): boolean {
  return b.high > b.low
}

/** Structural check used when walking a model for bands. */
export function isBand(value: unknown): value is Band {
  if (!isRecord(value)) return false
  return (
    typeof value.low === "number" &&
    typeof value.point === "number" &&
    typeof value.high === "number"
  )
}
