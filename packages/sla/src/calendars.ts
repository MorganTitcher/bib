/**
 * Two public-holiday calendars shipped as rule data: US federal holidays and
 * bank holidays in England & Wales. Both are plain `HolidayRule[]` arrays, so
 * you can extend them with spread syntax or filter out a holiday your
 * organisation works through.
 *
 * Coverage: both calendars are accurate from **1978** onwards (the first year
 * the current US Veterans Day date and the UK Early May bank holiday both
 * applied). One-off days announced by proclamation (jubilees, state funerals,
 * coronations) are listed as `date` rules up to 2023. Future proclamations are
 * not predictable: add them with `{ kind: "date", ... }` when announced.
 *
 * @example
 * ```ts
 * import { US_FEDERAL_HOLIDAYS, UK_ENGLAND_WALES_BANK_HOLIDAYS } from "@bib/sla/calendars"
 * import { resolveHolidays, type HolidayRule } from "@bib/sla/holidays"
 *
 * resolveHolidays(US_FEDERAL_HOLIDAYS, 2026).map((h) => h.date)
 * // ["2026-01-01", "2026-01-19", "2026-02-16", "2026-05-25", "2026-06-19", "2026-07-03", ...]
 *
 * const companyCalendar: HolidayRule[] = [
 *   ...UK_ENGLAND_WALES_BANK_HOLIDAYS,
 *   { kind: "fixed", name: "Christmas Eve", month: 12, day: 24 },
 * ]
 * ```
 */

import type { HolidayRule } from "./holidays.ts"

/** Weekday numbers used in the rules below (0 = Sunday). */
const MON = 1
const THU = 4

/**
 * US federal holidays (5 U.S.C. 6103). A Saturday holiday is observed on the
 * Friday before and a Sunday holiday on the Monday after, including New Year's
 * Day on a Saturday, which is observed on Friday 31 December of the year before.
 * Inauguration Day (Washington DC area only) is not included.
 */
export const US_FEDERAL_HOLIDAYS: readonly HolidayRule[] = [
  { kind: "fixed", name: "New Year's Day", month: 1, day: 1, observed: "nearest-weekday" },
  {
    kind: "nth-weekday",
    name: "Birthday of Martin Luther King, Jr.",
    month: 1,
    weekday: MON,
    nth: 3,
    fromYear: 1986,
  },
  { kind: "nth-weekday", name: "Washington's Birthday", month: 2, weekday: MON, nth: 3 },
  { kind: "last-weekday", name: "Memorial Day", month: 5, weekday: MON },
  {
    kind: "fixed",
    name: "Juneteenth National Independence Day",
    month: 6,
    day: 19,
    observed: "nearest-weekday",
    fromYear: 2021,
  },
  { kind: "fixed", name: "Independence Day", month: 7, day: 4, observed: "nearest-weekday" },
  { kind: "nth-weekday", name: "Labor Day", month: 9, weekday: MON, nth: 1 },
  { kind: "nth-weekday", name: "Columbus Day", month: 10, weekday: MON, nth: 2 },
  { kind: "fixed", name: "Veterans Day", month: 11, day: 11, observed: "nearest-weekday" },
  { kind: "nth-weekday", name: "Thanksgiving Day", month: 11, weekday: THU, nth: 4 },
  { kind: "fixed", name: "Christmas Day", month: 12, day: 25, observed: "nearest-weekday" },
]

/**
 * Bank holidays in England and Wales (Scotland and Northern Ireland differ). A
 * weekend holiday gets a "substitute day" on the next weekday that is not
 * already a holiday, so Christmas on a Saturday moves to Monday 27th and
 * Boxing Day on the Sunday moves to Tuesday 28th.
 *
 * Moved and extra days by proclamation are included: Early May moved to 8 May
 * in 1995 and 2020 (VE Day anniversaries), the Spring bank holiday moved for
 * the 2002, 2012 and 2022 jubilees, plus the 1999 millennium day, the 2011
 * royal wedding, the 2022 state funeral and the 2023 coronation.
 */
export const UK_ENGLAND_WALES_BANK_HOLIDAYS: readonly HolidayRule[] = [
  { kind: "fixed", name: "New Year's Day", month: 1, day: 1, observed: "next-weekday" },
  { kind: "easter", name: "Good Friday", offsetDays: -2 },
  { kind: "easter", name: "Easter Monday", offsetDays: 1 },
  {
    kind: "nth-weekday",
    name: "Early May bank holiday",
    month: 5,
    weekday: MON,
    nth: 1,
    fromYear: 1978,
    exceptYears: [1995, 2020],
  },
  { kind: "date", name: "Early May bank holiday (VE Day)", date: "1995-05-08" },
  { kind: "date", name: "Early May bank holiday (VE Day)", date: "2020-05-08" },
  {
    kind: "last-weekday",
    name: "Spring bank holiday",
    month: 5,
    weekday: MON,
    exceptYears: [2002, 2012, 2022],
  },
  { kind: "date", name: "Golden Jubilee bank holiday", date: "2002-06-03" },
  { kind: "date", name: "Spring bank holiday", date: "2002-06-04" },
  { kind: "date", name: "Spring bank holiday", date: "2012-06-04" },
  { kind: "date", name: "Diamond Jubilee bank holiday", date: "2012-06-05" },
  { kind: "date", name: "Spring bank holiday", date: "2022-06-02" },
  { kind: "date", name: "Platinum Jubilee bank holiday", date: "2022-06-03" },
  { kind: "last-weekday", name: "Summer bank holiday", month: 8, weekday: MON },
  { kind: "fixed", name: "Christmas Day", month: 12, day: 25, observed: "next-weekday" },
  { kind: "fixed", name: "Boxing Day", month: 12, day: 26, observed: "next-weekday" },
  { kind: "date", name: "Millennium celebrations", date: "1999-12-31" },
  { kind: "date", name: "Royal wedding", date: "2011-04-29" },
  { kind: "date", name: "State funeral of Queen Elizabeth II", date: "2022-09-19" },
  { kind: "date", name: "Coronation of King Charles III", date: "2023-05-08" },
]
