---
name: unit-economics
description: Compute CAC, LTV, LTV:CAC, payback, retention, burn, runway and breakeven from a business assumptions file, and run sensitivity on any input. Use when asked about profitability, pricing, payback, runway, or "what happens if churn/CAC changes".
---

# Unit economics

All math lives in `@bib/finance` (`packages/finance`). This skill only drives its CLI; never redo the arithmetic by hand.

## 1. Write the assumptions file

Copy `packages/finance/examples/saas.json` and fill it in. Every number is monthly. Rates are fractions (`0.03` = 3%).

| Field | Meaning |
| --- | --- |
| `arpa` | Average revenue per account per month |
| `grossMargin` | Gross margin as a fraction |
| `monthlyChurn` | Share of accounts lost per month |
| `monthlyExpansion` | Expansion revenue rate per month (default 0) |
| `acquisitionSpend`, `newCustomers` | One month of acquisition spend and the customers it produced |
| `fixedCostsMonthly`, `cash`, `customers` | For burn, runway and breakeven (default 0) |
| `lifetimeCapMonths` | Upper bound on customer lifetime (default 120) |

If the user did not give a number, ask for it rather than guessing. Never invent a benchmark.

## 2. Run it

From a bib checkout, after `pnpm install && pnpm build`:

```sh
node packages/finance/dist/cli.js path/to/assumptions.json
node packages/finance/dist/cli.js path/to/assumptions.json --sensitivity monthlyChurn
```

The output is JSON with three parts: `assumptions` (exactly what was used, defaults filled in), `metrics`, and `warnings`. A `null` metric is undefined, not zero (for example, runway when the business is not burning cash).

## 3. Report

- Lead with LTV:CAC, CAC payback and runway, then the rest.
- Quote every warning verbatim. A capped lifetime means LTV is a floor, not an estimate.
- Restate the assumptions you used so the reader can challenge them.
- For "what if" questions, use `--sensitivity <field>` and show the table, not a single point.
