# @bib/sla examples

## `support-desk.mjs`

A London support desk with split shifts, a shorter Friday, England & Wales bank
holidays, a Christmas Eve shutdown, a New Year's Eve half day, and a
high-priority ticket paused while waiting on the requester.

```sh
pnpm --filter @bib/sla build
node packages/sla/examples/support-desk.mjs
```

Expected output:

```text
2026 bank holidays: 8
Open Mon 12:45 London (lunch)? false
Next opening: 2026-03-16T13:30:00.000Z
Xmas deadline: 2026-12-29T11:30:00.000Z
Deadline after pause: 2026-03-17T11:30:00.000Z
Status: approaching | 3h 30m remaining | at risk: false
Escalate to: assignee
Double pause: already_paused
Business hours Mon-Fri week: 37
```

How to read it:

- The Christmas deadline uses 1.5 hours on Wednesday 23 December (16:00 to
  17:30). It then skips the closure on the 24th, Christmas Day, the weekend, and
  the Boxing Day substitute day on Monday 28th. The last 2.5 hours run on
  Tuesday 29th.
- The paused ticket used 1 hour before the pause and 4.5 hours after it, so 2.5
  of its 8 hours are left for Tuesday morning. The two paused hours never count.
- 4.5 of 8 business hours is 56% of the budget, which is past the 50%
  "approaching" threshold but short of the 75% at-risk threshold.
