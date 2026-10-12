import { describe, expect, it } from "vitest"
import {
  easterSunday,
  type HolidayRule,
  lastWeekdayOfMonth,
  nominalDate,
  nthWeekdayOfMonth,
  oneOffDates,
  resolveHolidays,
  validateHolidayRules,
} from "../src/holidays.ts"

describe("date rules", () => {
  it("computes Western Easter", () => {
    expect(easterSunday(2024)).toBe("2024-03-31")
    expect(easterSunday(2025)).toBe("2025-04-20")
    expect(easterSunday(2026)).toBe("2026-04-05")
    expect(easterSunday(2038)).toBe("2038-04-25")
    expect(easterSunday(2285)).toBe("2285-03-22")
  })

  it("finds the nth and last weekday", () => {
    expect(nthWeekdayOfMonth(2026, 11, 4, 4)).toBe("2026-11-26")
    expect(nthWeekdayOfMonth(2026, 1, 1, 3)).toBe("2026-01-19")
    expect(nthWeekdayOfMonth(2026, 2, 1, 5)).toBeUndefined()
    expect(lastWeekdayOfMonth(2026, 5, 1)).toBe("2026-05-25")
    expect(lastWeekdayOfMonth(2026, 8, 1)).toBe("2026-08-31")
  })

  it("respects year bounds and exceptions", () => {
    const rule: HolidayRule = {
      kind: "fixed",
      name: "Founders",
      month: 6,
      day: 1,
      fromYear: 2020,
      toYear: 2030,
      exceptYears: [2025],
    }
    expect(nominalDate(rule, 2019)).toBeUndefined()
    expect(nominalDate(rule, 2025)).toBeUndefined()
    expect(nominalDate(rule, 2026)).toBe("2026-06-01")
    expect(nominalDate(rule, 2031)).toBeUndefined()
  })

  it("skips a 29 February rule in non-leap years", () => {
    const leap: HolidayRule = { kind: "fixed", name: "Leap", month: 2, day: 29 }
    expect(nominalDate(leap, 2027)).toBeUndefined()
    expect(nominalDate(leap, 2028)).toBe("2028-02-29")
  })

  it("gives date rules only their own year", () => {
    const rule: HolidayRule = { kind: "date", name: "Offsite", date: "2026-09-04" }
    expect(nominalDate(rule, 2026)).toBe("2026-09-04")
    expect(nominalDate(rule, 2027)).toBeUndefined()
  })
})

describe("resolveHolidays", () => {
  it("shifts nearest-weekday holidays and spills across the year boundary", () => {
    const rules: HolidayRule[] = [
      { kind: "fixed", name: "New Year", month: 1, day: 1, observed: "nearest-weekday" },
    ]
    // 2022-01-01 is a Saturday: observed Friday 2021-12-31.
    expect(resolveHolidays(rules, 2021).map((h) => h.date)).toEqual(["2021-01-01", "2021-12-31"])
    expect(resolveHolidays(rules, 2022)).toEqual([])
    const spilled = resolveHolidays(rules, 2021)[1]
    expect(spilled).toEqual({
      date: "2021-12-31",
      actualDate: "2022-01-01",
      name: "New Year",
      observed: true,
    })
  })

  it("gives substitute days that skip dates already taken", () => {
    const rules: HolidayRule[] = [
      { kind: "fixed", name: "A", month: 12, day: 25, observed: "next-weekday" },
      { kind: "fixed", name: "B", month: 12, day: 26, observed: "next-weekday" },
    ]
    // 2027-12-25 is Saturday, 26 Sunday: substitutes Monday 27 and Tuesday 28.
    expect(resolveHolidays(rules, 2027).map((h) => [h.name, h.date])).toEqual([
      ["A", "2027-12-27"],
      ["B", "2027-12-28"],
    ])
    // 2026-12-26 is Saturday: Christmas stays Friday, B moves to Monday 28.
    expect(resolveHolidays(rules, 2026).map((h) => h.date)).toEqual(["2026-12-25", "2026-12-28"])
  })

  it("never displaces a holiday that stays put", () => {
    const rules: HolidayRule[] = [
      { kind: "fixed", name: "Sun", month: 3, day: 1, observed: "next-weekday" },
      { kind: "fixed", name: "Mon", month: 3, day: 2 },
    ]
    // 2026-03-01 is a Sunday; Monday is taken, so the substitute is Tuesday.
    expect(resolveHolidays(rules, 2026).map((h) => h.date)).toEqual(["2026-03-02", "2026-03-03"])
  })

  it("moves only Sunday holidays with sunday-to-monday", () => {
    const rules: HolidayRule[] = [
      { kind: "fixed", name: "X", month: 3, day: 1, observed: "sunday-to-monday" },
      { kind: "fixed", name: "Y", month: 3, day: 7, observed: "sunday-to-monday" },
    ]
    expect(resolveHolidays(rules, 2026).map((h) => h.date)).toEqual(["2026-03-02", "2026-03-07"])
  })

  it("honours custom weekend days", () => {
    const rules: HolidayRule[] = [
      { kind: "fixed", name: "Z", month: 3, day: 6, observed: "next-weekday" },
    ]
    // Friday 2026-03-06 is a weekend day with a Friday/Saturday weekend.
    expect(resolveHolidays(rules, 2026, { weekendDays: [5, 6] })[0]?.date).toBe("2026-03-08")
  })

  it("resolves Easter-relative holidays", () => {
    const rules: HolidayRule[] = [{ kind: "easter", name: "Good Friday", offsetDays: -2 }]
    expect(resolveHolidays(rules, 2026)[0]?.date).toBe("2026-04-03")
  })

  it("rejects a non-integer year", () => {
    expect(() => resolveHolidays([], 2026.5)).toThrow(RangeError)
  })
})

describe("validateHolidayRules", () => {
  it("accepts valid rules", () => {
    expect(validateHolidayRules(oneOffDates([{ date: "2026-05-01", name: "Offsite" }]))).toEqual([])
  })

  it("reports every problem with a path", () => {
    const bad = [
      { kind: "fixed", name: "", month: 2, day: 30 },
      { kind: "nth-weekday", name: "x", month: 13, weekday: 7, nth: 6 },
      { kind: "date", name: "y", date: "2026-02-30" },
      {
        kind: "fixed",
        name: "z",
        month: 1,
        day: 1,
        observed: "sometimes",
        fromYear: 2030,
        toYear: 2020,
      },
      { kind: "weird", name: "w" },
    ] as unknown as HolidayRule[]
    const paths = validateHolidayRules(bad, "rules").map((i) => i.path)
    expect(paths).toEqual([
      "rules[0].name",
      "rules[0].day",
      "rules[1].month",
      "rules[1].weekday",
      "rules[1].nth",
      "rules[2].date",
      "rules[3].observed",
      "rules[3].toYear",
      "rules[4].kind",
    ])
  })

  it("rejects a non-array", () => {
    expect(validateHolidayRules("x" as unknown as HolidayRule[])).toHaveLength(1)
  })
})
