import { resolveMonth } from "./months.ts"
import type { Channel } from "./schema.ts"

type PaidChannel = Extract<Channel, { type: "paid" }>

/**
 * Cost to acquire one customer at the reference spend level. A funnel's CAC is
 * `cpm / 1000 / (ctr × cvr)`; a dead funnel (`ctr` or `cvr` of 0) costs `Infinity`.
 *
 * ```ts
 * unitCac({ kind: "funnel", cpm: band(12), ctr: band(0.01), cvr: band(0.02) }) // 60
 * ```
 */
export function unitCac(unitCost: PaidChannel["unitCost"]): number {
  if (unitCost.kind === "cac") return unitCost.cac.point
  const conversion = unitCost.ctr.point * unitCost.cvr.point
  if (conversion <= 0) return Number.POSITIVE_INFINITY
  return unitCost.cpm.point / 1000 / conversion
}

/**
 * Customers bought by `spend` at unit cost `cac` under a response curve.
 *
 * - `linear`: `spend / cac`.
 * - `isoelastic`: `(ref / cac) × (spend / ref) ** elasticity`, exact at `referenceSpend`.
 * - `diminishing`: `(h / cac) × spend / (spend + h)`. Matches linear for small spend and
 *   saturates at `h / cac` customers.
 */
export function customersFromSpend(
  spend: number,
  cac: number,
  response: PaidChannel["response"],
): number {
  if (spend <= 0 || !Number.isFinite(cac) || cac <= 0) return 0
  switch (response.kind) {
    case "linear":
      return spend / cac
    case "isoelastic": {
      const ref = response.referenceSpend
      return (ref / cac) * (spend / ref) ** response.elasticity.point
    }
    case "diminishing": {
      const h = response.halfSaturationSpend
      return ((h / cac) * spend) / (spend + h)
    }
  }
}

/**
 * Normalized geometric adstock: `(1 - c) × spend + c × previous`. A steady spend
 * converges to itself, so carryover shifts timing without inflating volume.
 */
export function adstock(previous: number, spend: number, carryover: number): number {
  return (1 - carryover) * spend + carryover * previous
}

/** Linear ramp: month `k` after start runs at `(k + 1) / (rampMonths + 1)` efficiency, capped at 1. */
export function rampFactor(monthsSinceStart: number, rampMonths: number): number {
  if (monthsSinceStart < 0) return 0
  if (rampMonths <= 0) return 1
  return Math.min(1, (monthsSinceStart + 1) / (rampMonths + 1))
}

/** Spend a paid channel commits in projection month `m` (0 outside its start/end window). */
export function spendAt(channel: PaidChannel, m: number, startMonth?: string): number {
  const start = channel.start === undefined ? 0 : resolveMonth(channel.start, startMonth)
  const end =
    channel.end === undefined ? Number.POSITIVE_INFINITY : resolveMonth(channel.end, startMonth)
  if (m < start || m > end) return 0
  for (const row of channel.spendSchedule) {
    if (resolveMonth(row.month, startMonth) === m) return row.spend.point
  }
  return channel.spend.point * (1 + channel.spendGrowth.point) ** (m - start)
}
