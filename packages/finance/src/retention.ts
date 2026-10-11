import { z } from "zod"
import { type Band, rateBand } from "./band.ts"

/**
 * How a cohort of customers decays.
 *
 * - `constant`: the same share churns every month.
 * - `piecewise`: churn changes with customer age. `fromAge` is the age in months
 *   (1 = the first renewal after the acquisition month) at which a segment starts.
 * - `curve`: an explicit survival curve. `survival[i]` is the share of the
 *   cohort still active `i + 1` months after acquisition; after the last point
 *   `tailChurn` applies every month.
 */
export type RetentionCurve =
  | { kind: "constant"; monthlyChurn: Band }
  | { kind: "piecewise"; segments: { fromAge: number; monthlyChurn: Band }[] }
  | { kind: "curve"; survival: Band[]; tailChurn: Band }

export const retentionSchema = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("constant"), monthlyChurn: rateBand() }),
    z.object({
      kind: z.literal("piecewise"),
      segments: z
        .array(z.object({ fromAge: z.number().int().min(1), monthlyChurn: rateBand() }))
        .min(1),
    }),
    z.object({
      kind: z.literal("curve"),
      survival: z.array(rateBand()).min(1),
      tailChurn: rateBand(),
    }),
  ])
  .superRefine((curve, ctx) => {
    if (curve.kind === "piecewise") {
      const first = curve.segments[0]
      if (first !== undefined && first.fromAge !== 1) {
        ctx.addIssue({ code: "custom", message: "the first segment must start at fromAge 1" })
      }
      for (let i = 1; i < curve.segments.length; i++) {
        const prev = curve.segments[i - 1]
        const cur = curve.segments[i]
        if (prev !== undefined && cur !== undefined && cur.fromAge <= prev.fromAge) {
          ctx.addIssue({ code: "custom", message: "segments must be in increasing fromAge order" })
        }
      }
    }
    if (curve.kind === "curve") {
      let prev = 1
      for (const point of curve.survival) {
        if (point.point > prev) {
          ctx.addIssue({
            code: "custom",
            message: "survival must not increase with age (a cohort cannot gain customers back)",
          })
          return
        }
        prev = point.point
      }
    }
  })

function survivalPoint(curve: Extract<RetentionCurve, { kind: "curve" }>, age: number): number {
  if (age <= 0) return 1
  return curve.survival[age - 1]?.point ?? 0
}

/**
 * Share of the cohort that churns in the month a cohort reaches `age` (age 1 is
 * the first month after acquisition; age 0 never churns). Always in `[0, 1]`,
 * even when sampled survival points are out of order.
 */
export function churnAt(curve: RetentionCurve, age: number): number {
  if (age <= 0) return 0
  switch (curve.kind) {
    case "constant":
      return clamp01(curve.monthlyChurn.point)
    case "piecewise": {
      let churn = curve.segments[0]?.monthlyChurn.point ?? 0
      for (const segment of curve.segments) {
        if (segment.fromAge <= age) churn = segment.monthlyChurn.point
      }
      return clamp01(churn)
    }
    case "curve": {
      if (age > curve.survival.length) return clamp01(curve.tailChurn.point)
      const before = survivalPoint(curve, age - 1)
      const after = survivalPoint(curve, age)
      if (before <= 0) return 1
      return clamp01(1 - after / before)
    }
  }
}

/** Share of a cohort still active `age` months after acquisition. */
export function survivalAt(curve: RetentionCurve, age: number): number {
  let survival = 1
  for (let a = 1; a <= age; a++) survival *= 1 - churnAt(curve, a)
  return survival
}

/** Survival at ages `0..months - 1`. */
export function survivalSeries(curve: RetentionCurve, months: number): number[] {
  const out: number[] = []
  let survival = 1
  for (let a = 0; a < months; a++) {
    if (a > 0) survival *= 1 - churnAt(curve, a)
    out.push(survival)
  }
  return out
}

function clamp01(value: number): number {
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}
