import { describe, expect, it } from "vitest"
import {
  addDays,
  addMonthsClamped,
  daysBetween,
  daysInMonth,
  formatIsoDate,
  formatIsoDateParts,
  isLeapYear,
  isoMonthKey,
  MS_PER_DAY,
  monthsBetween,
  parseIsoDate,
  startOfMonth,
  zonedParts,
} from "../src/dates.ts"

const d = (s: string): Date => {
  const parsed = parseIsoDate(s)
  if (!parsed) throw new Error(`bad fixture ${s}`)
  return parsed
}

describe("calendar facts", () => {
  it("knows leap years and month lengths", () => {
    expect(isLeapYear(2024)).toBe(true)
    expect(isLeapYear(1900)).toBe(false)
    expect(isLeapYear(2000)).toBe(true)
    expect(daysInMonth(2024, 2)).toBe(29)
    expect(daysInMonth(2026, 2)).toBe(28)
    expect(daysInMonth(2026, 12)).toBe(31)
    expect(() => daysInMonth(2026, 13)).toThrow(RangeError)
    expect(MS_PER_DAY).toBe(86_400_000)
  })
})

describe("parseIsoDate / formatIsoDate", () => {
  it("parses strictly to UTC midnight", () => {
    expect(d("2026-01-31").toISOString()).toBe("2026-01-31T00:00:00.000Z")
    expect(parseIsoDate("2026-02-30")).toBeUndefined()
    expect(parseIsoDate("2026-13-01")).toBeUndefined()
    expect(parseIsoDate("2026-1-5")).toBeUndefined()
    expect(parseIsoDate("2026-01-05T00:00:00Z")).toBeUndefined()
    expect(parseIsoDate("2024-02-29")).toBeDefined()
    expect(parseIsoDate("0099-03-04")?.getUTCFullYear()).toBe(99)
  })
  it("formats", () => {
    expect(formatIsoDate(new Date("2026-07-04T23:59:59Z"))).toBe("2026-07-04")
    expect(() => formatIsoDate(new Date(Number.NaN))).toThrow(RangeError)
  })
})

describe("arithmetic", () => {
  it("adds days", () => {
    expect(formatIsoDate(addDays(d("2026-02-27"), 2))).toBe("2026-03-01")
    expect(formatIsoDate(addDays(d("2026-01-01"), -1))).toBe("2025-12-31")
    expect(() => addDays(d("2026-01-01"), 0.5)).toThrow(RangeError)
  })
  it("adds months with clamping and keeps the time", () => {
    expect(formatIsoDate(addMonthsClamped(d("2024-01-31"), 1))).toBe("2024-02-29")
    expect(formatIsoDate(addMonthsClamped(d("2026-03-31"), -1))).toBe("2026-02-28")
    expect(formatIsoDate(addMonthsClamped(d("2026-11-15"), 3))).toBe("2027-02-15")
    expect(formatIsoDate(addMonthsClamped(d("2026-01-15"), -13))).toBe("2024-12-15")
    expect(addMonthsClamped(new Date("2026-01-10T13:45:00Z"), 1).toISOString()).toBe(
      "2026-02-10T13:45:00.000Z",
    )
  })
  it("counts whole months", () => {
    expect(monthsBetween(d("2026-01-15"), d("2026-02-14"))).toBe(0)
    expect(monthsBetween(d("2026-01-15"), d("2026-02-15"))).toBe(1)
    expect(monthsBetween(d("2026-01-31"), d("2026-02-28"))).toBe(1)
    expect(monthsBetween(d("2026-01-15"), d("2026-04-14"))).toBe(2)
    expect(monthsBetween(d("2026-04-14"), d("2026-01-15"))).toBe(-2)
    expect(monthsBetween(d("2026-01-01"), d("2026-01-01"))).toBe(0)
  })
  it("counts calendar days ignoring time", () => {
    expect(daysBetween(new Date("2026-01-01T23:00:00Z"), new Date("2026-01-02T01:00:00Z"))).toBe(1)
    expect(daysBetween(d("2026-03-01"), d("2026-02-01"))).toBe(-28)
  })
  it("groups by month", () => {
    expect(startOfMonth(new Date("2026-07-04T12:00:00Z")).toISOString()).toBe(
      "2026-07-01T00:00:00.000Z",
    )
    expect(isoMonthKey(new Date("2026-07-04T12:00:00Z"))).toBe("2026-07")
  })
})

describe("zonedParts", () => {
  it("returns wall-clock fields in a timezone", () => {
    expect(zonedParts(new Date("2026-03-01T03:30:00Z"), "America/New_York")).toEqual({
      year: 2026,
      month: 2,
      day: 28,
      hour: 22,
      minute: 30,
      second: 0,
      weekday: 6,
    })
    expect(zonedParts(new Date("2026-01-01T00:00:00Z"), "UTC").hour).toBe(0)
    expect(zonedParts(new Date("2026-06-01T23:30:00Z"), "Asia/Tokyo").day).toBe(2)
  })
  it("throws for unknown timezones and invalid dates", () => {
    expect(() => zonedParts(new Date(), "Mars/Base")).toThrow(RangeError)
    expect(() => zonedParts(new Date(Number.NaN), "UTC")).toThrow(RangeError)
  })
})

describe("formatIsoDateParts", () => {
  it("zero-pads every field", () => {
    expect(formatIsoDateParts(2026, 3, 7)).toBe("2026-03-07")
    expect(formatIsoDateParts(5, 1, 1)).toBe("0005-01-01")
  })
  it("accepts leap days only in leap years", () => {
    expect(formatIsoDateParts(2024, 2, 29)).toBe("2024-02-29")
    expect(() => formatIsoDateParts(2026, 2, 29)).toThrow(RangeError)
  })
  it.each([
    [2026, 0, 1],
    [2026, 13, 1],
    [2026, 1, 0],
    [2026.5, 1, 1],
    [10_000, 1, 1],
  ])("rejects %i-%i-%i", (y, m, d) => {
    expect(() => formatIsoDateParts(y, m, d)).toThrow(RangeError)
  })
})
