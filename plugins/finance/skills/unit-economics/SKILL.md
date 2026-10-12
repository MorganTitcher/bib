---
name: unit-economics
description: Build or read a month-by-month finance model and report CAC, LTV, LTV:CAC, payback, runway, break-even, sensitivity (tornado), Monte Carlo ranges, scenarios, variance against actuals and goal-seeking. Use when asked about profitability, pricing, payback, runway, burn, or "what happens if churn/CAC/price changes".
---

# Unit economics

All math lives in `@bib/finance` (`packages/finance`). This skill only drives its CLI. Never redo
the arithmetic by hand, and never round or reinterpret a number the CLI printed.

From a bib checkout, run `pnpm install && pnpm build` once. The CLI is then:

```sh
node packages/finance/dist/cli.js <command> <model.json> [options]
```

## 1. Write the model

Start from the example closest to the business and edit it:

| Example | Shape |
| --- | --- |
| `packages/finance/examples/saas.json` | Subscription tiers, paid + organic + referral channels |
| `packages/finance/examples/marketplace.json` | Seller subscriptions plus take-rate on GMV, paid + sales channels |
| `packages/finance/examples/services.json` | Retainers, projects and one-time setup fees |

The top-level sections are `meta`, `opening`, `streams[]`, `revenueDeductions`, `channels[]`,
`costs`, `workingCapital`, `taxes`, `funding[]`, `seasonality`, `events[]`, `actuals[]` and
`scenarios[]`. The full schema is in `packages/finance/README.md`. The fields that matter most:

| Field | Meaning |
| --- | --- |
| `meta.horizonMonths` | Months to project (default 36) |
| `meta.lifetimeCapMonths` | The longest customer lifetime LTV will credit (default 60) |
| `streams[].tiers[]` | `price` and `mix` per tier (subscription streams) |
| `streams[].retention` | `monthlyChurn`, flat or `piecewise` by customer age |
| `channels[].spend`, `channels[].unitCost.cac` | Paid acquisition: monthly spend and cost per customer |
| `costs.cogs`, `costs.headcount[]`, `costs.opex[]` | What it costs to serve and run |
| `opening.cash` | Starting cash for runway |

Rates are fractions (`0.03` = 3%), and `*Bps` fields are basis points (`300` = 3%).

**Any input can be a band** instead of a number, with provenance attached:

```json
"cac": { "low": 250, "point": 320, "high": 450,
         "provenance": { "source": "search pilot, Q4", "evidence": "observed", "asOf": "2026-12" } }
```

`evidence` is `hypothesis`, `benchmark` or `observed`. Use bands for every input the user is unsure
of. They drive `tornado --band` and `montecarlo`.

If the user did not give a number, ask for it rather than guessing. Never invent a benchmark. If you
must use an estimate to keep going, mark it `"evidence": "hypothesis"` and say so.

Check the file before reporting anything:

```sh
node packages/finance/dist/cli.js validate model.json   # "Model is valid." or a list of problems
```

## 2. Pick the command

| Question | Command |
| --- | --- |
| Headline numbers | `summary` (revenue, margin, EBITDA, MRR/ARR, cash, runway, break-even) |
| CAC, LTV, payback per channel | `economics` |
| Month-by-month P&L and cash | `project` (`--csv` for a spreadsheet, `--cohorts` for cohorts) |
| Which input matters most? | `tornado --outcome endingCash --limit 5` (`--band` uses each input's low/high; otherwise `--pct 0.2` flexes by ±20%) |
| How uncertain is this? | `montecarlo --runs 1000 --seed 1` (P10/P50/P90 and the chance cash goes negative) |
| Plan vs alternatives | `compare` (base against every entry in `scenarios[]`), or `--scenario <id>` on any command |
| Plan vs reality | `variance --tolerance 0.1` (needs `actuals[]`) |
| "What churn/CAC do we need?" | `backsolve --path <input path> --outcome <outcome> --target <n> --lo <n> --hi <n>` |

Outcomes for `--outcome` are listed by `--help`, for example `endingCash`, `endingMrr`,
`totalEbitda`, `minCash` and `runwayMonths`. Add `--json` to any command for machine-readable output.

Exit codes: `0` is ok, `2` is a usage error, and `1` means the file could not be read, the model is
invalid, or the run failed. On a non-zero exit, show the error and fix the model. Do not report numbers.

Example (`economics` on the SaaS example):

```
Channel search: CAC $356.16, LTV $1,562.97, LTV:CAC 4.4, payback 7.7 months
Channel organic: CAC $0.00, LTV $1,562.97, LTV:CAC n/a, payback n/a
Warning: core: 14.2% of customers are still active at the 60-month lifetime cap, ...
```

## 3. Report

- Lead with LTV:CAC, CAC payback and runway, then the rest.
- Quote every warning verbatim. A capped lifetime means LTV is a ceiling, not a floor: it is the most the model will credit, not an estimate.
- `n/a` (or `null` in JSON) means undefined, not zero. For example, LTV:CAC for a channel with no attributed spend.
- Restate the inputs that drive the answer and their `evidence` level, so the reader can challenge
  them. Flag any headline that rests mostly on `hypothesis` inputs.
- For "what if" questions, show a `tornado` or `montecarlo` range, not a single point.
