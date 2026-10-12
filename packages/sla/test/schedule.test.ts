import { ValidationError } from "@bib/shared/errors"
import { describe, expect, it } from "vitest"
import { US_FEDERAL_HOLIDAYS } from "../src/calendars.ts"
import {
  createSchedule,
  defineSchedule,
  type ScheduleConfig,
  weekdayHours,
} from "../src/schedule.ts"

const NY = "America/New_York"
const iso = (d: Date): string => d.toISOString()

describe("weekdayHours", () => {
  it("builds Monday-Friday by default", () => {
    expect(Object.keys(weekdayHours("09:00", "17:00"))).toEqual(["mon", "tue", "wed", "thu", "fri"])
    expect(weekdayHours("10:00", "16:00", [6])).toEqual({ sat: [{ start: "10:00", end: "16:00" }] })
  })

  it("rejects a bad weekday", () => {
    expect(() => weekdayHours("09:00", "17:00", [7])).toThrow(RangeError)
  })
})

describe("createSchedule validation", () => {
  const issues = (config: unknown): string[] => {
    const r = createSchedule(config as ScheduleConfig)
    expect(r.ok).toBe(false)
    return r.ok ? [] : r.error.issues.map((i) => i.path)
  }

  it("accepts a valid config", () => {
    expect(createSchedule({ timeZone: NY, weekly: weekdayHours("09:00", "17:00") }).ok).toBe(true)
  })

  it("reports an unknown time zone", () => {
    expect(issues({ timeZone: "Nowhere/City", weekly: weekdayHours("09:00", "17:00") })).toEqual([
      "timeZone",
    ])
  })

  it("reports bad shift times, equal times and overlaps", () => {
    const paths = issues({
      timeZone: "UTC",
      weekly: {
        mon: [{ start: "9:00", end: "25:00" }],
        tue: [{ start: "09:00", end: "09:00" }],
        wed: [
          { start: "09:00", end: "13:00" },
          { start: "12:00", end: "17:00" },
        ],
        thu: [{ start: "24:00", end: "10:00" }],
        funday: [],
      },
    })
    expect(paths).toEqual([
      "weekly.funday",
      "weekly.mon[0].start",
      "weekly.mon[0].end",
      "weekly.tue[0]",
      "weekly.wed",
      "weekly.thu[0].start",
    ])
  })

  it("requires at least one shift", () => {
    expect(issues({ timeZone: "UTC", weekly: {} })).toEqual(["weekly"])
  })

  it("reports bad overrides, closures, holidays and weekend days", () => {
    const paths = issues({
      timeZone: "UTC",
      weekly: weekdayHours("09:00", "17:00"),
      dateOverrides: [
        { date: "2026-02-30", shifts: [] },
        { date: "2026-03-01", shifts: [] },
        { date: "2026-03-01", shifts: [] },
      ],
      closures: ["2026-13-01", { date: "x" }, "2026-04-01"],
      holidays: [{ kind: "fixed", name: "Bad", month: 0, day: 1 }],
      observedWeekendDays: [9],
    })
    expect(paths).toEqual([
      "dateOverrides[0].date",
      "dateOverrides[2].date",
      "closures[0]",
      "closures[1]",
      "holidays[0].month",
      "observedWeekendDays",
    ])
  })

  it("rejects a non-object", () => {
    expect(issues(null)).toEqual([""])
  })

  it("defineSchedule throws the ValidationError", () => {
    expect(() => defineSchedule({ timeZone: "UTC", weekly: {} })).toThrow(ValidationError)
  })
})

describe("day queries", () => {
  const schedule = defineSchedule({
    timeZone: NY,
    weekly: {
      ...weekdayHours("09:00", "17:00"),
      sat: [
        { start: "09:00", end: "12:00" },
        { start: "13:00", end: "15:00" },
      ],
    },
    holidays: US_FEDERAL_HOLIDAYS,
    closures: [{ date: "2026-12-24", name: "Christmas Eve" }, "2026-12-31"],
    dateOverrides: [
      { date: "2026-11-27", shifts: [{ start: "09:00", end: "13:00" }], name: "Half day" },
      { date: "2026-07-03", shifts: [{ start: "10:00", end: "12:00" }], name: "On call" },
    ],
  })

  it("explains each day", () => {
    expect(schedule.dayInfo("2026-03-02")).toMatchObject({ kind: "regular", open: true })
    expect(schedule.dayInfo("2026-03-01")).toMatchObject({ kind: "closed", open: false })
    expect(schedule.dayInfo("2026-12-25")).toMatchObject({ kind: "holiday", name: "Christmas Day" })
    expect(schedule.dayInfo("2026-12-24")).toMatchObject({ kind: "closure", name: "Christmas Eve" })
    expect(schedule.dayInfo("2026-12-31")).toMatchObject({ kind: "closure", open: false })
    expect(schedule.dayInfo("2026-11-27")).toMatchObject({ kind: "override", name: "Half day" })
  })

  it("lets an override beat a holiday", () => {
    expect(schedule.dayInfo("2026-07-03").kind).toBe("override")
    expect(schedule.isBusinessDay("2026-07-03")).toBe(true)
  })

  it("returns split-shift intervals in UTC", () => {
    expect(schedule.intervalsOn("2026-03-07").map((i) => [iso(i.start), iso(i.end)])).toEqual([
      ["2026-03-07T14:00:00.000Z", "2026-03-07T17:00:00.000Z"],
      ["2026-03-07T18:00:00.000Z", "2026-03-07T20:00:00.000Z"],
    ])
    expect(Object.isFrozen(schedule.intervalsOn("2026-03-07"))).toBe(true)
  })

  it("reads a Date in the schedule's zone", () => {
    // 02:00 UTC Monday is still Sunday evening in New York.
    expect(schedule.dayInfo(new Date("2026-03-02T02:00:00Z")).date).toBe("2026-03-01")
  })

  it("steps over holidays and closures", () => {
    expect(schedule.nextBusinessDay("2026-12-23")).toBe("2026-12-26")
    expect(schedule.previousBusinessDay("2026-12-26")).toBe("2026-12-23")
    expect(schedule.addBusinessDays("2026-12-23", 2)).toBe("2026-12-28")
    expect(schedule.addBusinessDays("2026-12-28", -2)).toBe("2026-12-23")
    expect(schedule.addBusinessDays("2026-12-25", 0)).toBe("2026-12-25")
  })

  it("counts business days with an exclusive end, across the year boundary", () => {
    expect(schedule.countBusinessDays("2026-03-02", "2026-03-02")).toBe(0)
    expect(schedule.countBusinessDays("2026-03-02", "2026-03-09")).toBe(6)
    expect(schedule.countBusinessDays("2026-03-09", "2026-03-02")).toBe(-6)
    // 28, 29, 30 Dec + 2 Jan (Sat); 31 Dec closure, 1 Jan holiday.
    expect(schedule.countBusinessDays("2026-12-28", "2027-01-04")).toBe(4)
  })

  it("lists holidays per year", () => {
    expect(schedule.holidaysIn(2026)).toHaveLength(11)
    expect(schedule.holidayOn("2026-11-26")?.name).toBe("Thanksgiving Day")
    expect(schedule.holidayOn("2026-11-25")).toBeUndefined()
  })

  it("rejects bad date input", () => {
    expect(() => schedule.dayInfo("2026-02-30")).toThrow(RangeError)
    expect(() => schedule.dayInfo(new Date(Number.NaN))).toThrow(RangeError)
    expect(() => schedule.addBusinessDays("2026-03-02", 1.5)).toThrow(RangeError)
  })

  it("skips a holiday on the only open weekday", () => {
    const never = defineSchedule({
      timeZone: "UTC",
      weekly: weekdayHours("09:00", "17:00", [1]),
      holidays: [{ kind: "nth-weekday", name: "First Monday", month: 1, weekday: 1, nth: 1 }],
    })
    expect(never.isBusinessDay("2026-01-05")).toBe(false)
    expect(never.nextBusinessDay("2026-01-01")).toBe("2026-01-12")
  })
})

describe("overnight shifts and DST", () => {
  it("assigns an overnight shift to the day it starts", () => {
    const s = defineSchedule({
      timeZone: "UTC",
      weekly: { fri: [{ start: "22:00", end: "06:00" }] },
    })
    expect(s.intervalsOn("2026-03-06").map((i) => [iso(i.start), iso(i.end)])).toEqual([
      ["2026-03-06T22:00:00.000Z", "2026-03-07T06:00:00.000Z"],
    ])
    expect(s.isBusinessDay("2026-03-07")).toBe(false)
  })

  it("makes an all-day shift 23 or 25 hours long on DST days", () => {
    const s = defineSchedule({ timeZone: NY, weekly: { sun: [{ start: "00:00", end: "24:00" }] } })
    const length = (date: string): number => {
      const [iv] = s.intervalsOn(date)
      return iv === undefined ? 0 : (iv.end.getTime() - iv.start.getTime()) / 3_600_000
    }
    expect(length("2026-03-08")).toBe(23)
    expect(length("2026-11-01")).toBe(25)
    expect(length("2026-03-15")).toBe(24)
  })

  it("moves a shift inside the spring-forward gap forward by the gap", () => {
    const s = defineSchedule({ timeZone: NY, weekly: { sun: [{ start: "02:00", end: "02:30" }] } })
    expect(s.intervalsOn("2026-03-08").map((i) => [iso(i.start), iso(i.end)])).toEqual([
      ["2026-03-08T07:00:00.000Z", "2026-03-08T07:30:00.000Z"],
    ])
  })

  it("throws when no business day exists for years", () => {
    const allMondays = Array.from({ length: 12 }, (_, m) =>
      [1, 2, 3, 4, 5].map((nth) => ({
        kind: "nth-weekday" as const,
        name: "Closed",
        month: m + 1,
        weekday: 1,
        nth,
      })),
    ).flat()
    const s = defineSchedule({
      timeZone: "UTC",
      weekly: weekdayHours("09:00", "17:00", [1]),
      holidays: allMondays,
    })
    expect(() => s.nextBusinessDay("2026-01-01")).toThrow(RangeError)
  })
})
