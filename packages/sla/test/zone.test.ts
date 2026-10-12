import { describe, expect, it } from "vitest"
import {
  isValidTimeZone,
  localDateOf,
  localMinuteOf,
  offsetAt,
  parseWallTime,
  shiftIsoDate,
  wallTimeToInstant,
  weekdayOf,
} from "../src/zone.ts"

const NY = "America/New_York"

describe("parseWallTime", () => {
  it("parses strict HH:MM", () => {
    expect(parseWallTime("00:00")).toBe(0)
    expect(parseWallTime("09:30")).toBe(570)
    expect(parseWallTime("23:59")).toBe(1439)
    expect(parseWallTime("24:00")).toBe(1440)
  })

  it("rejects malformed times", () => {
    for (const bad of ["9:00", "24:01", "12:60", "25:00", "", "09:00:00", "ab:cd"]) {
      expect(parseWallTime(bad)).toBeUndefined()
    }
  })
})

describe("isValidTimeZone", () => {
  it("accepts IANA zones and UTC", () => {
    expect(isValidTimeZone("UTC")).toBe(true)
    expect(isValidTimeZone("Europe/London")).toBe(true)
  })

  it("rejects unknown zones and empty input", () => {
    expect(isValidTimeZone("Mars/Olympus")).toBe(false)
    expect(isValidTimeZone("")).toBe(false)
  })
})

describe("offsets and local parts", () => {
  it("reports DST offsets", () => {
    expect(offsetAt(Date.parse("2026-01-15T12:00:00Z"), NY)).toBe(-5 * 3_600_000)
    expect(offsetAt(Date.parse("2026-07-15T12:00:00Z"), NY)).toBe(-4 * 3_600_000)
    expect(offsetAt(Date.parse("2026-07-15T12:00:00Z"), "Asia/Kolkata")).toBe(5.5 * 3_600_000)
  })

  it("reads the local date and minute across midnight", () => {
    const d = new Date("2026-03-02T03:30:00Z")
    expect(localDateOf(d, NY)).toBe("2026-03-01")
    expect(localMinuteOf(d, NY)).toBe(22 * 60 + 30)
    expect(localDateOf(d, "Asia/Tokyo")).toBe("2026-03-02")
  })

  it("throws on an invalid Date", () => {
    expect(() => localDateOf(new Date(Number.NaN), NY)).toThrow(RangeError)
    expect(() => localMinuteOf(new Date(Number.NaN), NY)).toThrow(RangeError)
  })
})

describe("date helpers", () => {
  it("shifts across month, year and leap boundaries", () => {
    expect(shiftIsoDate("2026-12-31", 1)).toBe("2027-01-01")
    expect(shiftIsoDate("2027-01-01", -1)).toBe("2026-12-31")
    expect(shiftIsoDate("2028-02-28", 1)).toBe("2028-02-29")
  })

  it("returns the weekday", () => {
    expect(weekdayOf("2026-03-01")).toBe(0)
    expect(weekdayOf("2026-03-07")).toBe(6)
  })

  it("throws on malformed dates", () => {
    expect(() => shiftIsoDate("2026-02-30", 1)).toThrow(RangeError)
    expect(() => weekdayOf("nope")).toThrow(RangeError)
  })
})

describe("wallTimeToInstant", () => {
  it("converts an ordinary wall time", () => {
    expect(wallTimeToInstant("2026-07-01", 9 * 60, NY).toISOString()).toBe(
      "2026-07-01T13:00:00.000Z",
    )
    expect(wallTimeToInstant("2026-07-01", 1440, NY).toISOString()).toBe("2026-07-02T04:00:00.000Z")
  })

  it("moves a time in the spring-forward gap forward", () => {
    // 02:30 does not exist on 2026-03-08 in New York; it lands at 03:30 EDT.
    expect(wallTimeToInstant("2026-03-08", 150, NY).toISOString()).toBe("2026-03-08T07:30:00.000Z")
  })

  it("takes the earlier instant for an ambiguous fall-back time", () => {
    // 01:30 happens twice on 2026-11-01; the first is EDT (UTC-4).
    expect(wallTimeToInstant("2026-11-01", 90, NY).toISOString()).toBe("2026-11-01T05:30:00.000Z")
  })

  it("rejects bad input", () => {
    expect(() => wallTimeToInstant("2026-13-01", 0, NY)).toThrow(RangeError)
    expect(() => wallTimeToInstant("2026-01-01", 1441, NY)).toThrow(RangeError)
    expect(() => wallTimeToInstant("2026-01-01", 1.5, NY)).toThrow(RangeError)
  })
})
