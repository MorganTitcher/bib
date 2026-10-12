import { describe, expect, it } from "vitest"
import { UK_ENGLAND_WALES_BANK_HOLIDAYS } from "../src/calendars.ts"
import {
  addBusinessTime,
  addCalendarTime,
  businessIntervalsFrom,
  businessTimeBetween,
  hours,
  isOpen,
  minutes,
  nextClosing,
  nextOpening,
} from "../src/clock.ts"
import { defineSchedule, weekdayHours } from "../src/schedule.ts"

const at = (s: string): Date => new Date(s)
const iso = (d: Date | undefined): string | undefined => d?.toISOString()

const utc = defineSchedule({ timeZone: "UTC", weekly: weekdayHours("09:00", "17:00") })
const london = defineSchedule({
  timeZone: "Europe/London",
  weekly: weekdayHours("09:00", "17:00"),
  holidays: UK_ENGLAND_WALES_BANK_HOLIDAYS,
})

describe("units", () => {
  it("converts hours and minutes", () => {
    expect(hours(2)).toBe(7_200_000)
    expect(minutes(1.5)).toBe(90_000)
  })
})

describe("addBusinessTime", () => {
  it("carries over the weekend", () => {
    expect(iso(addBusinessTime(london, at("2026-03-13T15:00:00Z"), hours(4)))).toBe(
      "2026-03-16T11:00:00.000Z",
    )
  })

  it("ends at closing time when the duration exactly fits", () => {
    expect(iso(addBusinessTime(utc, at("2026-03-02T09:00:00Z"), hours(8)))).toBe(
      "2026-03-02T17:00:00.000Z",
    )
  })

  it("returns start for zero when open, otherwise the next opening", () => {
    expect(iso(addBusinessTime(utc, at("2026-03-02T10:00:00Z"), 0))).toBe(
      "2026-03-02T10:00:00.000Z",
    )
    expect(iso(addBusinessTime(utc, at("2026-03-02T18:00:00Z"), 0))).toBe(
      "2026-03-03T09:00:00.000Z",
    )
  })

  it("starts the clock at the next opening when closed", () => {
    expect(iso(addBusinessTime(utc, at("2026-03-07T12:00:00Z"), hours(1)))).toBe(
      "2026-03-09T10:00:00.000Z",
    )
  })

  it("skips bank holidays including weekend substitute days", () => {
    // Thu 24 Dec 2026 16:00 + 2h -> Fri 25 holiday, Mon 28 substitute -> Tue 29 10:00.
    expect(iso(addBusinessTime(london, at("2026-12-24T16:00:00Z"), hours(2)))).toBe(
      "2026-12-29T10:00:00.000Z",
    )
  })

  it("crosses the year boundary", () => {
    // Thu 31 Dec 16:00 + 2h -> Fri 1 Jan holiday, weekend -> Mon 4 Jan 10:00.
    expect(iso(addBusinessTime(london, at("2026-12-31T16:00:00Z"), hours(2)))).toBe(
      "2027-01-04T10:00:00.000Z",
    )
  })

  it("keeps wall-clock hours across a DST change", () => {
    // London springs forward Sun 29 Mar 2026; 09:00 local becomes 08:00Z.
    expect(iso(addBusinessTime(london, at("2026-03-27T16:00:00Z"), hours(2)))).toBe(
      "2026-03-30T09:00:00.000Z",
    )
  })

  it("rejects invalid input", () => {
    expect(() => addBusinessTime(utc, at("2026-03-02T10:00:00Z"), -1)).toThrow(RangeError)
    expect(() => addBusinessTime(utc, at("2026-03-02T10:00:00Z"), Number.NaN)).toThrow(RangeError)
    expect(() => addBusinessTime(utc, new Date(Number.NaN), 1)).toThrow(RangeError)
  })
})

describe("businessTimeBetween", () => {
  it("measures business time and is negative when reversed", () => {
    const a = at("2026-03-13T15:00:00Z")
    const b = at("2026-03-16T11:00:00Z")
    expect(businessTimeBetween(london, a, b)).toBe(hours(4))
    expect(businessTimeBetween(london, b, a)).toBe(-hours(4))
    expect(businessTimeBetween(london, a, a)).toBe(0)
  })

  it("counts nothing outside hours", () => {
    expect(businessTimeBetween(utc, at("2026-03-07T00:00:00Z"), at("2026-03-09T09:00:00Z"))).toBe(0)
  })

  it("rejects an invalid Date", () => {
    expect(() => businessTimeBetween(utc, at("x"), at("2026-03-02T09:00:00Z"))).toThrow(RangeError)
  })
})

describe("overnight shifts", () => {
  const night = defineSchedule({
    timeZone: "UTC",
    weekly: { fri: [{ start: "22:00", end: "06:00" }], mon: [{ start: "09:00", end: "17:00" }] },
  })

  it("adds time across midnight into the next shift", () => {
    expect(iso(addBusinessTime(night, at("2026-03-06T23:00:00Z"), hours(8)))).toBe(
      "2026-03-09T10:00:00.000Z",
    )
  })

  it("sees Friday's shift as open early Saturday", () => {
    expect(isOpen(night, at("2026-03-07T01:00:00Z"))).toBe(true)
    expect(isOpen(night, at("2026-03-07T06:00:00Z"))).toBe(false)
    expect(iso(nextClosing(night, at("2026-03-07T01:00:00Z")))).toBe("2026-03-07T06:00:00.000Z")
  })
})

describe("open and closed", () => {
  it("is start-inclusive and end-exclusive", () => {
    expect(isOpen(utc, at("2026-03-02T09:00:00Z"))).toBe(true)
    expect(isOpen(utc, at("2026-03-02T17:00:00Z"))).toBe(false)
  })

  it("finds the next opening and closing", () => {
    expect(iso(nextOpening(utc, at("2026-03-02T10:00:00Z")))).toBe("2026-03-02T10:00:00.000Z")
    expect(iso(nextOpening(utc, at("2026-03-06T17:00:00Z")))).toBe("2026-03-09T09:00:00.000Z")
    expect(iso(nextClosing(utc, at("2026-03-02T10:00:00Z")))).toBe("2026-03-02T17:00:00.000Z")
    expect(iso(nextClosing(utc, at("2026-03-02T18:00:00Z")))).toBe("2026-03-02T18:00:00.000Z")
  })

  it("merges back-to-back shifts and returns undefined for 24/7", () => {
    const allDay = [{ start: "00:00", end: "24:00" }]
    const always = defineSchedule({
      timeZone: "UTC",
      weekly: {
        sun: allDay,
        mon: allDay,
        tue: allDay,
        wed: allDay,
        thu: allDay,
        fri: allDay,
        sat: allDay,
      },
    })
    expect(nextClosing(always, at("2026-03-02T10:00:00Z"))).toBeUndefined()
    const weekdays = defineSchedule({ timeZone: "UTC", weekly: weekdayHours("00:00", "24:00") })
    expect(iso(nextClosing(weekdays, at("2026-03-02T10:00:00Z")))).toBe("2026-03-07T00:00:00.000Z")
  })

  it("throws when a schedule has no business time for years", () => {
    const allMondays = Array.from({ length: 12 }, (_, m) =>
      [1, 2, 3, 4, 5].map((nth) => ({
        kind: "nth-weekday" as const,
        name: "Closed",
        month: m + 1,
        weekday: 1,
        nth,
      })),
    ).flat()
    const never = defineSchedule({
      timeZone: "UTC",
      weekly: weekdayHours("09:00", "17:00", [1]),
      holidays: allMondays,
    })
    expect(() => businessIntervalsFrom(never, at("2026-01-01T00:00:00Z")).next()).toThrow(
      RangeError,
    )
    expect(() => addBusinessTime(never, at("2026-01-01T00:00:00Z"), 1)).toThrow(RangeError)
  })
})

describe("addCalendarTime", () => {
  it("ignores opening hours", () => {
    expect(iso(addCalendarTime(at("2026-03-07T12:00:00Z"), hours(2)))).toBe(
      "2026-03-07T14:00:00.000Z",
    )
    expect(() => addCalendarTime(at("2026-03-07T12:00:00Z"), -1)).toThrow(RangeError)
  })
})
