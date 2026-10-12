// Runnable example: a London support desk with split shifts, UK bank holidays,
// a company closure, and a ticket paused while waiting on the requester.
//
// Run after building:  pnpm --filter @bib/sla build && node packages/sla/examples/support-desk.mjs
// Expected output is listed in examples/README.md.

import { UK_ENGLAND_WALES_BANK_HOLIDAYS } from "@bib/sla/calendars"
import { addBusinessTime, businessTimeBetween, hours, isOpen, nextOpening } from "@bib/sla/clock"
import { defineSchedule } from "@bib/sla/schedule"
import { budgetFor, DEFAULT_PRIORITY_BUDGETS, escalationTier, evaluate } from "@bib/sla/status"
import { pauseTimer, resumeTimer, startTimer, timerDeadline } from "@bib/sla/timer"

const shifts = [
  { start: "09:00", end: "12:30" },
  { start: "13:30", end: "17:30" },
]
const desk = defineSchedule({
  timeZone: "Europe/London",
  weekly: {
    mon: shifts,
    tue: shifts,
    wed: shifts,
    thu: shifts,
    fri: [{ start: "09:00", end: "16:00" }],
  },
  holidays: [...UK_ENGLAND_WALES_BANK_HOLIDAYS],
  closures: [{ date: "2026-12-24", name: "Christmas Eve shutdown" }],
  dateOverrides: [
    { date: "2026-12-31", shifts: [{ start: "09:00", end: "12:00" }], name: "Half day" },
  ],
})

const iso = (d) => (d === null ? "null" : d.toISOString())

console.log("2026 bank holidays:", desk.holidaysIn(2026).length)
console.log("Open Mon 12:45 London (lunch)?", isOpen(desk, new Date("2026-03-16T12:45:00Z")))
console.log("Next opening:", iso(nextOpening(desk, new Date("2026-03-16T12:45:00Z"))))

// A ticket raised on Wednesday 23 December at 16:00 with a 4-business-hour target
// rolls over the closure, Christmas, Boxing Day substitute and the weekend.
const raised = new Date("2026-12-23T16:00:00Z")
console.log("Xmas deadline:", iso(addBusinessTime(desk, raised, hours(4))))

// A high-priority ticket, paused for two hours while waiting on the requester.
let timer = startTimer(
  new Date("2026-03-16T09:00:00Z"),
  budgetFor(DEFAULT_PRIORITY_BUDGETS, "high"),
)
const paused = pauseTimer(timer, new Date("2026-03-16T10:00:00Z"), "waiting on requester")
if (paused.ok) timer = paused.value
const resumed = resumeTimer(timer, new Date("2026-03-16T12:00:00Z"))
if (resumed.ok) timer = resumed.value
console.log("Deadline after pause:", iso(timerDeadline(desk, timer)))

const status = evaluate(desk, timer, new Date("2026-03-16T16:30:00Z"))
console.log("Status:", status.level, "|", status.displayText, "| at risk:", status.atRisk)
console.log("Escalate to:", escalationTier(status.fraction)?.notify.join(", "))

const again = pauseTimer(pauseTimer(timer, new Date("2026-03-16T16:30:00Z")).value, new Date())
console.log("Double pause:", again.ok ? "allowed" : again.error.reason)

console.log(
  "Business hours Mon-Fri week:",
  businessTimeBetween(desk, new Date("2026-03-16T00:00:00Z"), new Date("2026-03-21T00:00:00Z")) /
    hours(1),
)
