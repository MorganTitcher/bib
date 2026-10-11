import { describe, expect, it } from "vitest"
import { calendarMonthOf, isMonthKey, monthLabel, resolveMonth } from "../src/months.ts"

describe("months", () => {
  it("recognizes calendar months", () => {
    expect(isMonthKey("2027-03")).toBe(true)
    expect(isMonthKey("2027-13")).toBe(false)
    expect(isMonthKey("2027-3")).toBe(false)
  })

  it("resolves indexes and calendar months", () => {
    expect(resolveMonth(3)).toBe(3)
    expect(resolveMonth("2027-03", "2027-01")).toBe(2)
    expect(resolveMonth("2028-01", "2027-11")).toBe(2)
  })

  it("rejects bad references", () => {
    expect(() => resolveMonth(-1)).toThrow(RangeError)
    expect(() => resolveMonth(1.5)).toThrow(RangeError)
    expect(() => resolveMonth("2027-03")).toThrow(/startMonth/)
    expect(() => resolveMonth("2026-12", "2027-01")).toThrow(/before/)
  })

  it("labels months with or without a start", () => {
    expect(monthLabel(0)).toBe("M1")
    expect(monthLabel(13, "2027-11")).toBe("2028-12")
  })

  it("maps to calendar months for seasonality", () => {
    expect(calendarMonthOf(0)).toBe(0)
    expect(calendarMonthOf(2, "2027-11")).toBe(0)
  })
})
