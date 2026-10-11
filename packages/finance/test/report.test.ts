import { toMajorString } from "@bib/shared/money"
import { describe, expect, it } from "vitest"
import { project } from "../src/engine.ts"
import {
  cohortsToCsv,
  formatAmount,
  projectionToCsv,
  summaryLines,
  toMoney,
} from "../src/report.ts"
import { minimalModel } from "./fixtures.ts"

describe("toMoney / formatAmount", () => {
  it("rounds to the currency's minor unit", () => {
    expect(formatAmount(1234.567, "USD")).toBe("$1,234.57")
    expect(formatAmount(1234.567, "JPY")).toBe("¥1,235")
  })

  it("prints a tiny negative as zero, not -0.00", () => {
    expect(formatAmount(-0.001, "USD")).toBe("$0.00")
  })

  it("keeps real negatives", () => {
    expect(formatAmount(-5.5, "USD")).toContain("5.50")
    expect(formatAmount(-5.5, "USD")).toMatch(/-/)
  })

  it("throws on a non-finite amount", () => {
    expect(() => toMoney(Number.NaN, "USD")).toThrow(RangeError)
    expect(() => toMoney(Number.POSITIVE_INFINITY, "USD")).toThrow(RangeError)
  })

  it("produces exact money", () => {
    expect(toMajorString(toMoney(10.1, "USD"))).toBe("10.10")
    expect(toMajorString(toMoney(-0.004, "USD"))).toBe("0.00")
  })
})

describe("projectionToCsv", () => {
  it("has a header and one row per month", () => {
    const csv = projectionToCsv(project(minimalModel()))
    const lines = csv.trim().split(/\r?\n/)
    expect(lines).toHaveLength(13)
    expect(lines[0]?.split(",")).toEqual(
      expect.arrayContaining(["month", "mrrEnding", "netRevenue", "cash", "burn", "headcount"]),
    )
  })
})

describe("cohortsToCsv", () => {
  it("writes stream, cohort and one column per age", () => {
    const projection = project(minimalModel({ meta: { name: "M", horizonMonths: 3 } }))
    const csv = cohortsToCsv(projection.cohorts)
    const [header, ...rows] = csv.trim().split(/\r?\n/)
    expect(header).toBe("stream,cohort,age0,age1,age2")
    expect(rows.length).toBe(projection.cohorts.length)
    expect(rows[0]?.startsWith("core,")).toBe(true)
  })

  it("handles no cohorts", () => {
    expect(cohortsToCsv([]).trim()).toBe("stream,cohort")
  })
})

describe("summaryLines", () => {
  it("includes headline numbers and warnings", () => {
    const projection = project(minimalModel())
    const withWarning = { ...projection, warnings: ["something odd"] }
    const lines = summaryLines(withWarning)
    expect(lines[0]).toBe("Minimal (12 months)")
    expect(lines.some((l) => l.startsWith("Net revenue: $"))).toBe(true)
    expect(lines.some((l) => l.startsWith("Runway: "))).toBe(true)
    expect(lines.at(-1)).toBe("Warning: something odd")
  })
})
