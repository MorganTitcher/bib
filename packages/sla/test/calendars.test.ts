import { describe, expect, it } from "vitest"
import { UK_ENGLAND_WALES_BANK_HOLIDAYS, US_FEDERAL_HOLIDAYS } from "../src/calendars.ts"
import { resolveHolidays, validateHolidayRules } from "../src/holidays.ts"

const dates = (rules: Parameters<typeof resolveHolidays>[0], year: number): string[] =>
  resolveHolidays(rules, year).map((h) => h.date)

describe("US_FEDERAL_HOLIDAYS", () => {
  it("is valid", () => {
    expect(validateHolidayRules(US_FEDERAL_HOLIDAYS)).toEqual([])
  })

  it("matches the 2026 OPM schedule", () => {
    expect(dates(US_FEDERAL_HOLIDAYS, 2026)).toEqual([
      "2026-01-01",
      "2026-01-19",
      "2026-02-16",
      "2026-05-25",
      "2026-06-19",
      "2026-07-03",
      "2026-09-07",
      "2026-10-12",
      "2026-11-11",
      "2026-11-26",
      "2026-12-25",
    ])
  })

  it("observes a Saturday New Year's Day on 31 December of the year before", () => {
    const y2021 = dates(US_FEDERAL_HOLIDAYS, 2021)
    expect(y2021).toContain("2021-06-18")
    expect(y2021).toContain("2021-12-24")
    expect(y2021.at(-1)).toBe("2021-12-31")
    expect(dates(US_FEDERAL_HOLIDAYS, 2022)[0]).toBe("2022-01-17")
  })

  it("applies start years", () => {
    expect(dates(US_FEDERAL_HOLIDAYS, 2020)).not.toContain("2020-06-19")
    expect(dates(US_FEDERAL_HOLIDAYS, 1985)).toHaveLength(9)
  })
})

describe("UK_ENGLAND_WALES_BANK_HOLIDAYS", () => {
  it("is valid", () => {
    expect(validateHolidayRules(UK_ENGLAND_WALES_BANK_HOLIDAYS)).toEqual([])
  })

  it("matches 2026", () => {
    expect(dates(UK_ENGLAND_WALES_BANK_HOLIDAYS, 2026)).toEqual([
      "2026-01-01",
      "2026-04-03",
      "2026-04-06",
      "2026-05-04",
      "2026-05-25",
      "2026-08-31",
      "2026-12-25",
      "2026-12-28",
    ])
  })

  it("gives weekend Christmas and Boxing Day substitute days", () => {
    expect(dates(UK_ENGLAND_WALES_BANK_HOLIDAYS, 2027).slice(-2)).toEqual([
      "2027-12-27",
      "2027-12-28",
    ])
    expect(dates(UK_ENGLAND_WALES_BANK_HOLIDAYS, 2021).slice(-2)).toEqual([
      "2021-12-27",
      "2021-12-28",
    ])
  })

  it("includes the 2022 proclamation days and Monday 3 January", () => {
    expect(dates(UK_ENGLAND_WALES_BANK_HOLIDAYS, 2022)).toEqual([
      "2022-01-03",
      "2022-04-15",
      "2022-04-18",
      "2022-05-02",
      "2022-06-02",
      "2022-06-03",
      "2022-08-29",
      "2022-09-19",
      "2022-12-26",
      "2022-12-27",
    ])
  })

  it("moves Early May to VE Day in 2020 and adds the 2023 coronation", () => {
    const y2020 = dates(UK_ENGLAND_WALES_BANK_HOLIDAYS, 2020)
    expect(y2020).toContain("2020-05-08")
    expect(y2020).not.toContain("2020-05-04")
    expect(dates(UK_ENGLAND_WALES_BANK_HOLIDAYS, 2023)).toContain("2023-05-08")
  })
})
