# @bib/sla

Business-hours SLA engine. Define opening hours in any IANA time zone, with
split shifts, overnight shifts, rule-based public holidays, closures and
one-day overrides. Then compute deadlines, elapsed business time, pausable
timers, and breach or at-risk status per priority tier.

## Rule: no runtime dependencies

The only dependency is `@bib/shared`. Time zones come from the platform's
`Intl` API, so no tz database is bundled and nothing else is needed on Node 20+,
in browsers or on edge runtimes.

## Importing

Every module is a subpath export. Import from the narrowest one you need:

```ts
import { defineSchedule, weekdayHours } from "@bib/sla/schedule"
import { addBusinessTime, hours } from "@bib/sla/clock"
```

The root `@bib/sla` barrel re-exports every public name explicitly (never
`export *`).

## Maturity

The whole package is `experimental` (`"bib": { "maturity": "experimental" }` in
`package.json`). APIs may still change.

| Module | Status | Ported from | Notes |
|---|---|---|---|
| `zone` | experimental | new | Intl-based offsets, local dates and minutes, wall time to instant. DST gaps move forward and ambiguous times take the earlier instant |
| `holidays` | experimental | new (replaces Haven's hardcoded list) | Rules: fixed, nth weekday, last weekday, Easter-relative, one-off date. Observed shifting, year ranges and exceptions |
| `calendars` | experimental | new | US federal holidays and England & Wales bank holidays, accurate from 1978 |
| `schedule` | experimental | Haven shared sla (generalized) | Per-weekday split and overnight shifts, holidays, closures, date overrides. Business-day stepping and counting |
| `clock` | experimental | Haven shared sla (generalized) | `addBusinessTime`, `businessTimeBetween`, `isOpen`, `nextOpening`, `nextClosing` |
| `timer` | experimental | Haven shared sla (generalized) | Immutable, JSON-safe pausable timer. Invalid pause or resume returns a `TimerError` |
| `status` | experimental | Haven shared sla (generalized) | Levels, breach and at-risk flags, priority budgets, escalation tiers. Measured in business time |

## Usage

Each example runs as-is in an ESM module against the build.

### `schedule`: opening hours

```ts
import { US_FEDERAL_HOLIDAYS } from "@bib/sla/calendars"
import { createSchedule, defineSchedule, weekdayHours } from "@bib/sla/schedule"

const office = defineSchedule({
  timeZone: "America/New_York",
  weekly: weekdayHours("09:00", "17:00"),
  holidays: US_FEDERAL_HOLIDAYS,
  closures: [{ date: "2026-11-27", name: "Day after Thanksgiving" }],
  dateOverrides: [{ date: "2026-12-24", shifts: [{ start: "09:00", end: "13:00" }] }],
})

office.dayInfo("2026-07-03").kind // "holiday" (Independence Day observed)
office.nextBusinessDay("2026-11-25") // "2026-11-30"
office.countBusinessDays("2026-12-21", "2026-12-28") // 4 (end date excluded)
office.intervalsOn("2026-12-24") // one 09:00-13:00 interval

// Split shifts and an overnight shift.
const support = defineSchedule({
  timeZone: "UTC",
  weekly: {
    mon: [{ start: "08:00", end: "12:00" }, { start: "13:00", end: "17:00" }],
    fri: [{ start: "22:00", end: "06:00" }], // runs into Saturday, belongs to Friday
  },
})
support.intervalsOn("2026-03-13").length // 1, ending 2026-03-14T06:00Z

// createSchedule returns a Result instead of throwing.
const bad = createSchedule({ timeZone: "Mars/Olympus", weekly: {} })
bad.ok // false; bad.error.issues lists each problem with a path
```

### `clock`: deadlines and elapsed business time

```ts
import { addBusinessTime, businessTimeBetween, hours, isOpen, nextClosing, nextOpening } from "@bib/sla/clock"
import { defineSchedule, weekdayHours } from "@bib/sla/schedule"

const schedule = defineSchedule({ timeZone: "Europe/London", weekly: weekdayHours("09:00", "17:00") })
const friday = new Date("2026-03-13T15:00:00Z")

addBusinessTime(schedule, friday, hours(4)) // 2026-03-16T11:00:00.000Z (Monday)
businessTimeBetween(schedule, friday, new Date("2026-03-16T11:00:00Z")) // 14_400_000
isOpen(schedule, new Date("2026-03-14T12:00:00Z")) // false (Saturday)
nextOpening(schedule, new Date("2026-03-14T12:00:00Z")) // 2026-03-16T09:00:00.000Z
nextClosing(schedule, friday) // 2026-03-13T17:00:00.000Z
```

### `holidays` and `calendars`: rule-based public holidays

```ts
import { UK_ENGLAND_WALES_BANK_HOLIDAYS } from "@bib/sla/calendars"
import { easterSunday, type HolidayRule, resolveHolidays } from "@bib/sla/holidays"

easterSunday(2027) // "2027-03-28"

// Christmas 2027 is a Saturday: substitute days on Monday 27th and Tuesday 28th.
resolveHolidays(UK_ENGLAND_WALES_BANK_HOLIDAYS, 2027).slice(-2).map((h) => h.date)
// ["2027-12-27", "2027-12-28"]

const company: HolidayRule[] = [
  { kind: "fixed", name: "Founders' Day", month: 9, day: 12, observed: "nearest-weekday" },
  { kind: "nth-weekday", name: "Summer Friday", month: 7, weekday: 5, nth: 2, fromYear: 2025 },
  { kind: "easter", name: "Easter Tuesday", offsetDays: 2 },
]
resolveHolidays(company, 2026).map((h) => h.date) // ["2026-04-07", "2026-07-10", "2026-09-11"]
```

### `timer`: pause and resume

```ts
import { hours } from "@bib/sla/clock"
import { defineSchedule, weekdayHours } from "@bib/sla/schedule"
import { pauseTimer, resumeTimer, startTimer, timerDeadline } from "@bib/sla/timer"

const schedule = defineSchedule({ timeZone: "UTC", weekly: weekdayHours("09:00", "17:00") })
let timer = startTimer(new Date("2026-03-02T09:00:00Z"), hours(8))
const paused = pauseTimer(timer, new Date("2026-03-02T11:00:00Z"), "waiting on requester")
if (paused.ok) timer = paused.value
timerDeadline(schedule, timer) // null while paused
const resumed = resumeTimer(timer, new Date("2026-03-02T15:00:00Z"))
if (resumed.ok) timer = resumed.value
timerDeadline(schedule, timer) // 2026-03-03T13:00:00.000Z

const twice = resumeTimer(timer, new Date("2026-03-02T16:00:00Z"))
twice.ok // false; twice.error.reason === "not_paused", status 409

JSON.parse(JSON.stringify(timer)) // a valid timer: instants are epoch milliseconds
```

### `status`: levels, breach and escalation

```ts
import { defineSchedule, weekdayHours } from "@bib/sla/schedule"
import { budgetFor, DEFAULT_PRIORITY_BUDGETS, escalationTier, evaluate } from "@bib/sla/status"

const schedule = defineSchedule({ timeZone: "UTC", weekly: weekdayHours("09:00", "17:00") })
const ticket = {
  startedAt: new Date("2026-03-02T09:00:00Z"),
  budgetMs: budgetFor(DEFAULT_PRIORITY_BUDGETS, "high"), // 8 business hours
}

const status = evaluate(schedule, ticket, new Date("2026-03-02T15:00:00Z"))
status.level // "warning" (6 of 8 hours, 75%)
status.atRisk // true
status.displayText // "2h remaining"
escalationTier(status.fraction)?.name // "Lead alert"

evaluate(schedule, ticket, new Date("2026-03-03T10:30:00Z")).displayText // "1h 30m overdue"

// Custom thresholds: at risk from "approaching" onwards.
evaluate(schedule, ticket, new Date("2026-03-02T12:00:00Z"), {
  thresholds: { approaching: 0.25, warning: 0.5, critical: 0.8 },
  atRiskFrom: "approaching",
}).level // "approaching"
```

A full runnable script with documented output is in
[`examples/`](./examples/README.md).

## Semantics

- **Precedence for one date:** `dateOverrides` beat `closures`, which beat
  holidays, which beat the weekly hours.
- **Overnight shifts** (end at or before start) belong to the day they start.
  `"24:00"` is a valid end time. A shift with start equal to end is rejected.
- **DST:** wall times follow the Temporal "compatible" rule. A time inside a
  spring-forward gap moves forward by the gap; an ambiguous fall-back time takes
  the earlier instant. Business time is real elapsed time, so an all-day shift is
  23 or 25 hours long on change days.
- **Deadlines** that exactly use up a shift end at its closing time. A zero
  duration returns the start if open, otherwise the next opening.
- **Errors:** invalid configuration returns (or, from `define*`, throws) a
  `ValidationError` with an `issues` list. Invalid runtime arguments throw
  `RangeError`. Out-of-order timer calls return a `TimerError`.

### Differences from the Haven original

- Status levels use **business** time used divided by the budget. Haven used
  wall-clock time, so tickets aged over nights and weekends.
- Breached means elapsed business time is at least the budget (Haven:
  remaining below zero). The fraction is not capped at 1.
- Holidays are rules evaluated for any year, not a hardcoded 2026 list.
- Holidays, closures, per-weekday hours, split shifts, overnight shifts and
  pausing are new.

## Limits

- **Calendars** are accurate from 1978. One-off proclamation days are listed up
  to 2023; future ones cannot be predicted, so add them as `date` rules.
- **Easter** uses the Gregorian computus, for years 1583 and later.
- **Offsets** have one-second precision, the resolution `Intl` reports.
- **No subtraction:** there is no "business time before" an instant.
- **Closed-run guard:** a schedule with no business time in 3,700 consecutive
  days throws a `RangeError` rather than looping.
- **Cache:** each schedule caches per-day intervals and clears the cache at
  4,096 entries.
- `nextClosing` returns `undefined` for a schedule that stays open longer than
  its horizon (default 366 days), for example 24/7.
