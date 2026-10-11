import { isRecord } from "@bib/shared/guards"
import { type Band, isBand, type Provenance, withPoint } from "./band.ts"
import type { FinanceModel } from "./schema.ts"

/** One uncertain input, addressed by a dotted path such as `channels.search.spend`. */
export interface BandEntry {
  path: string
  band: Band
  /** The band's own provenance, or the model's `meta.defaultProvenance`. */
  provenance?: Provenance
}

/** Sections that hold assumptions. Actuals and scenarios are data about the model, not inputs. */
const INPUT_SECTIONS = [
  "meta",
  "streams",
  "revenueDeductions",
  "channels",
  "costs",
  "workingCapital",
  "taxes",
  "funding",
  "events",
] as const

function segmentFor(item: unknown, index: number): string {
  if (isRecord(item) && typeof item.id === "string") return item.id
  return String(index)
}

function walk(value: unknown, path: string[], out: BandEntry[], fallback?: Provenance): void {
  if (isBand(value)) {
    const entry: BandEntry = { path: path.join("."), band: value }
    const provenance = value.provenance ?? fallback
    if (provenance !== undefined) entry.provenance = provenance
    out.push(entry)
    return
  }
  if (Array.isArray(value)) {
    for (const [i, item] of value.entries())
      walk(item, [...path, segmentFor(item, i)], out, fallback)
    return
  }
  if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) walk(item, [...path, key], out, fallback)
  }
}

/**
 * Every band in the model, in document order. Array items with an `id` use it as
 * the path segment; others (survival points, price changes) use their index.
 *
 * ```ts
 * listBands(model).map((e) => e.path)
 * // ["meta.discountRateAnnual", "streams.core.tiers.pro.price", ...]
 * ```
 */
export function listBands(model: FinanceModel): BandEntry[] {
  const out: BandEntry[] = []
  const fallback = model.meta.defaultProvenance
  for (const section of INPUT_SECTIONS) walk(model[section], [section], out, fallback)
  return out
}

function resolveContainer(root: unknown, segments: string[]): unknown {
  let current: unknown = root
  for (const segment of segments) {
    if (Array.isArray(current)) {
      const byId = current.find((item) => isRecord(item) && item.id === segment)
      current = byId ?? (/^\d+$/.test(segment) ? current[Number(segment)] : undefined)
    } else if (isRecord(current)) {
      current = current[segment]
    } else {
      return undefined
    }
  }
  return current
}

/** The band at `path`, or `undefined` when the path does not name a band. */
export function getBand(model: FinanceModel, path: string): Band | undefined {
  const found = resolveContainer(model, path.split("."))
  return isBand(found) ? found : undefined
}

/**
 * A copy of `model` with the bands at the given paths moved to new points
 * (clamped to each band's hard limits). Throws on an unknown path.
 */
export function withBandPoints(
  model: FinanceModel,
  points: Readonly<Record<string, number>>,
): FinanceModel {
  const copy = structuredClone(model)
  for (const [path, value] of Object.entries(points)) {
    const segments = path.split(".")
    const key = segments.pop()
    const parent = resolveContainer(copy, segments)
    if (key === undefined || parent === undefined)
      throw new RangeError(`unknown band path: ${path}`)
    const current: unknown = Array.isArray(parent)
      ? parent[Number(key)]
      : isRecord(parent)
        ? parent[key]
        : undefined
    if (!isBand(current)) throw new RangeError(`unknown band path: ${path}`)
    const next = withPoint(current, value)
    if (Array.isArray(parent)) parent[Number(key)] = next
    else if (isRecord(parent)) parent[key] = next
  }
  return copy
}

/** Shorthand for a single band. */
export function setBandPoint(model: FinanceModel, path: string, value: number): FinanceModel {
  return withBandPoints(model, { [path]: value })
}
