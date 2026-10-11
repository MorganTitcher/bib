# @bib/finance

A month-by-month finance model for an early-stage business. You describe the
business as one JSON document: revenue streams, customer cohorts, acquisition
channels, costs, working capital, taxes and funding. The package projects it
into a monthly P&L, cash flow and balance sheet. From that projection it
answers the usual questions:

- What are CAC, LTV and payback per channel?
- Which assumption matters most?
- How wide is the range of outcomes?
- How did the plan compare with what actually happened?
- What spend do I need to hit a target?

Every input is a **band**: a point estimate with an optional `low`..`high`
range and provenance (who said so, and how sure they are). The projection always
runs on the point. The ranges drive the tornado and the Monte Carlo.

The engine calculates in floats. Amounts become exact money only at the edges:
`toMoney` and `formatAmount` go through `@bib/shared/money`.

## Install and import

`@bib/finance` is a private workspace package:

```json
{ "dependencies": { "@bib/finance": "workspace:*" } }
```

Every module is a subpath export. The root barrel re-exports every public name
explicitly.

```ts
import { project } from "@bib/finance/engine"
import { assertModel, FinanceModelSchema } from "@bib/finance/schema"
import { unitEconomics, tornado, monteCarlo } from "@bib/finance"
```

The package also ships a `bib-finance` CLI. See [CLI](#cli).

## Maturity

The whole package is `experimental` (`"bib": { "maturity": "experimental" }`).
Fields and outputs may still change, and in-repo consumers are updated in the
same change.

| Module | Status | Ported from | Notes |
|---|---|---|---|
| `band` | experimental | occullm `acquisition/assumptions` (bands + provenance) | Bands, limits, provenance, triangular sampling |
| `months` | experimental | new | Month references: index or `"YYYY-MM"`; labels |
| `retention` | experimental | occullm `acquisition` (cohort retention) | Constant, piecewise and survival-curve churn |
| `schema` | experimental | new; replaces the previous basic model | zod schema `FinanceModelSchema`, `parseModel`, `assertModel` |
| `paths` | experimental | new | List, read and override bands by id path |
| `acquisition` | experimental | occullm `acquisition` (channel response, ramp, carryover) | CAC/funnel unit cost, spend response, adstock, ramp |
| `engine` | experimental | new | `project()`: monthly P&L, cash flow, balance, MRR waterfall, cohorts |
| `metrics` | experimental | new | Named outcomes for the analysis tools |
| `unit-economics` | experimental | occullm `acquisition/economics`; adsights unit-economics skill | NRR/GRR, LTV (capped, discounted), CAC, payback |
| `sensitivity` | experimental | occullm `acquisition/sensitivity` | One-at-a-time tornado, ±20% or band, ranked |
| `monte-carlo` | experimental | occullm `acquisition` (uncertainty) | P10/P50/P90 using `@bib/shared/random` and `stats` |
| `scenarios` | experimental | new | Named overrides; compare against base |
| `variance` | experimental | occullm `acquisition/reconciliation` | MAPE, share within tolerance, bias |
| `solve` | experimental | occullm `acquisition` (milestone backsolve) | Bisection backsolve; break-even months |
| `report` | experimental | new | CSV exports, text summary, exact money |
| `cli` | experimental | new; replaces the previous basic CLI | `bib-finance` |

## The model

`FinanceModelSchema` (from `schema`) is the full contract. The tables below list
every top-level section with its real field names. Every money, rate, count, bps
or growth field is a band. Fields marked *(0)* default to zero.

### Bands

A band is either a bare number (no uncertainty) or an object:

```json
{ "low": 0.02, "point": 0.03, "high": 0.05,
  "provenance": { "source": "billing export", "evidence": "observed", "asOf": "2026-09" } }
```

- `evidence` is one of `hypothesis`, `benchmark` or `observed`.
- The schema enforces hard limits for each kind of field:
  - rate: 0..1
  - bps: 0..10000
  - money and count: ≥ 0
  - growth: ≥ -1
- `low > point`, `point > high` and non-finite values are rejected.
- `meta.defaultProvenance` applies to any band that carries no provenance.

```ts
import { band } from "@bib/finance/band"
band(0.03)                                                      // { low: 0.03, point: 0.03, high: 0.03 }
band(0.02, 0.03, 0.05, { source: "x", evidence: "benchmark" })  // with range and provenance
```

### Months

A month reference is either a 0-based index or `"YYYY-MM"`. The `"YYYY-MM"` form
requires `meta.startMonth`.

```ts
import { resolveMonth, monthLabel } from "@bib/finance/months"
resolveMonth("2027-04", "2027-01") // 3
monthLabel(3, "2027-01")           // "2027-04"
monthLabel(3)                      // "M4"
```

### Sections

| Section | Fields |
|---|---|
| `meta` | `name`, `currency` (ISO 4217, default `USD`), `startMonth`, `horizonMonths` (default 36, max 240), `lifetimeCapMonths` (default 60), `discountRateAnnual` *(0)*, `defaultProvenance` |
| `opening` | `cash`, `receivables`, `payables`, `deferredRevenue`, `taxLossCarryforward` (plain numbers, default 0) |
| `streams[]` | one or more of the five stream types below |
| `revenueDeductions` | `discountBps`, `refundBps`, `paymentFeeBps`, `platformFeeBps` *(0)*; any stream can override them with `deductions` |
| `channels[]` | `paid`, `organic`, `referral`, `sales` |
| `costs` | `cogs` {`perActiveCustomer`, `revenueShare`, `perUsageUnit`}, `headcount[]`, `opex[]`, `capex[]` |
| `workingCapital` | `dsoDays`, `dpoDays`, `badDebtBps` *(0)* |
| `taxes` | `rate` *(0)*; losses carry forward |
| `funding[]` | `equity`, `safe`, `debt`, `grant`, `rbf` |
| `seasonality` | `acquisition`, `volume`: twelve multipliers each, January first (requires `startMonth` for calendar alignment) |
| `events[]` | `id`, `month`, `kind` (`revenue`/`expense`/`otherIncome`), `amount`, `department` |
| `actuals[]` | `month`, `metric` (`netRevenue`, `mrr`, `newCustomers`, `activeCustomers`, `grossProfit`, `opex`, `ebitda`, `netIncome`, `cash`, `burn`), `value` |
| `scenarios[]` | `id`, `name`, `overrides`: band path → number, or `"low"`/`"high"` |

**Streams**

| `type` | Fields |
|---|---|
| `subscription` | `tiers[]` {`id`, `price`, `mix`}; the mixes must sum to 1. Also `annualPrepaidShare`, `expansion`, `contraction`, `retention`, `opening` {`customers`, `arpa`, `ageMonths`}, `priceChanges[]` {`month`, `pct`, `appliesTo`: `new`/`all`}, `deductions` |
| `usage` | `customersOf`, `unitsPerCustomer`, `baseUnits`, `unitGrowth`, `pricePerUnit` |
| `oneTime` | `perNewCustomerOf`, `amount`, `schedule[]` {`month`, `amount`} |
| `services` | `hours`, `hoursGrowth`, `hoursPerNewCustomer`, `newCustomersOf`, `rate`, `deliveryCostShare` |
| `marketplace` | `gmv`, `gmvGrowth`, `gmvPerActiveCustomer`, `customersOf`, `takeRateBps`, `paymentFeeBps`, `paymentFeeOn` (`gmv`/`revenue`) |

`retention` takes one of three shapes:

- `{ "kind": "constant", "monthlyChurn": … }`
- `{ "kind": "piecewise", "segments": [{ "fromAge": 1, "monthlyChurn": … }, …] }`
- `{ "kind": "curve", "survival": [s1, s2, …], "tailChurn": … }`

Survival values are cumulative by age, starting at age 1.

```ts
import { survivalSeries } from "@bib/finance/retention"
import { band } from "@bib/finance/band"
survivalSeries({ kind: "piecewise", segments: [
  { fromAge: 1, monthlyChurn: band(0.1) }, { fromAge: 3, monthlyChurn: band(0.02) },
] }, 5) // [1, 0.9, 0.81, 0.7938, 0.7779]
```

**Channels**

| `type` | Fields |
|---|---|
| `paid` | `stream`, `spend`, `spendGrowth`, `spendSchedule[]`, `start`, `end`, `rampMonths`, `unitCost`, `response`, `demandCap`, `carryover`, `salesCycleMonths` |
| `organic` | `stream`, `customers`, `growth`, `start` |
| `referral` | `stream`, `rate` (new customers per active customer per month) |
| `sales` | `stream`, `role` (a headcount role id), `customersPerRep`, `rampMonths` (default 3), `salesCycleMonths` |

- **`unitCost`** sets what one customer costs to acquire:
  - `{ "kind": "cac", "cac": … }`
  - `{ "kind": "funnel", "cpm", "ctr", "cvr" }`
- **`response`** sets how customers scale with spend (default `linear`):
  - `{ "kind": "linear" }`
  - `{ "kind": "isoelastic", "referenceSpend", "elasticity" }`
  - `{ "kind": "diminishing", "halfSaturationSpend" }`

**Costs and funding**

- **`headcount[]`**:
  - `id`, `department` (`cogs`/`rd`/`sm`/`ga`), `salary` (annual), `count`
  - `benefitsLoad`, `annualRaise`, `commissionRate`
  - `hires[]` {`month`, `count`}
  - `trigger` {`metric`: `activeCustomers`/`newCustomers`/`netRevenue`, `per`, `maxCount`}
- **`opex[]`** is keyed by `rule`: `fixed` (`amount`), `growth` (`amount`, `growth`), `revenueShare` (`share`) or `perHead` (`perHead`). Each line also has `department`, `start` and `end`.
- **`capex[]`**: `id`, `month`, `amount`, `usefulLifeMonths`. Depreciation is straight-line.
- **`funding[]`**:
  - `equity`, `grant` and `safe`: `month`, `amount`. A SAFE also takes `valuationCap`.
  - `debt`: `principal`, `annualRate`, `termMonths`, `interestOnlyMonths`.
  - `rbf`: `amount`, `revenueShare`, `repaymentCap`.

### Validating

```ts
import { parseModel, assertModel } from "@bib/finance/schema"
const result = parseModel({ meta: { name: "" }, streams: [] })
// result.ok === false
// result.error[0] → { path: "meta.name", message: "Too small: expected string to have >=1 characters" }
// result.error[1] → { path: "streams", message: "Too small: expected array to have >=1 items" }
const model = assertModel(json) // throws on the same problems
```

Beyond shape, the schema also checks:

- ids are unique;
- `customersOf`, `stream` and `role` references resolve;
- tier mixes sum to 1;
- `"YYYY-MM"` references have a `startMonth` and fall inside the horizon;
- scenario paths exist.

## Usage per module

All outputs shown were produced by running the snippet against the built package.
The running model:

```ts
import { assertModel } from "@bib/finance/schema"
const model = assertModel({
  meta: { name: "Tiny SaaS", currency: "USD", startMonth: "2027-01", horizonMonths: 12 },
  opening: { cash: 250000 },
  streams: [{ type: "subscription", id: "core", tiers: [{ id: "base", price: 99, mix: 1 }],
    retention: { kind: "constant", monthlyChurn: { low: 0.02, point: 0.03, high: 0.05,
      provenance: { source: "billing export", evidence: "observed" } } } }],
  channels: [{ type: "paid", id: "ads", spend: 5000,
    unitCost: { kind: "cac", cac: { low: 150, point: 200, high: 300 } } }],
  costs: { headcount: [{ id: "eng", department: "rd", salary: 120000, count: 2, benefitsLoad: 0.2 }] },
})
```

### engine: `project(model)`

```ts
import { project } from "@bib/finance/engine"
import { formatAmount } from "@bib/finance/report"
const p = project(model)
p.months.length                              // 12; p.months[0].label === "2027-01"
p.summary.ending.customers                   // 255.1 (fractional: see "Not yet")
formatAmount(p.summary.ending.mrr, "USD")    // "$25,258.01"
formatAmount(p.summary.ending.cash, "USD")   // "$75,324.50"
p.summary.runway                             // { months: 32.1…, basis: "extrapolated" }
```

Each `MonthRow` has these fields:

- `index`, `label`
- `customers` {`new`, `churned`, `active`}
- `mrr` {`starting`, `new`, `expansion`, `contraction`, `priceChange`, `churn`, `ending`}
- `arr`, `streams`, `revenue` {`gross`, `net`, …}, `billings`, `cogs`
- `grossProfit`, `grossMargin`, `opex`, `channelSpend`, `headcount`
- `ebitda`, `depreciation`, `interest`, `otherIncome`, `pretaxIncome`, `tax`, `netIncome`
- `cashFlow` {`operating`, `fundingIn`, `net`, …}, `burn`, `balance` {`cash`, …}

The MRR waterfall holds every month: `starting + new + expansion - contraction + priceChange - churn = ending`. The balance sheet balances every month.

`summary` has these fields:

- `totals`, `grossMargin`
- `ending` {`mrr`, `arr`, `customers`, `cash`, `headcount`}
- `minCash`, `cashOutMonth`
- `runway` {`months`, `basis`}, `currentBurn`
- `ebitdaBreakEven`, `cashFlowBreakEven`

`p.cohorts` lists customers by stream, cohort and age. `p.warnings` collects modeling caveats.

### unit-economics

```ts
import { monthlyNrr, annualNrr, lifetimeValue, paybackMonths, cacFromFunnel, unitEconomics } from "@bib/finance/unit-economics"
monthlyNrr({ monthlyChurn: 0.02, expansion: 0.03 }) // 1.01, i.e. 1 - churn + expansion on the starting base (not 0.98 × 1.03)
annualNrr({ monthlyChurn: 0.02, expansion: 0.03 })  // 1.1268
cacFromFunnel({ cpm: 20, ctr: 0.01, cvr: 0.02 })    // 100

const lv = lifetimeValue({ arpa: 100, grossMargin: 0.8,
  retention: { kind: "constant", monthlyChurn: band(0.05) }, capMonths: 36 })
lv.ltv              // 1347.55
lv.survivalAtCap    // 0.158: 15.8% are still active at the cap, so LTV is a ceiling
paybackMonths(300, lv.contribution) // 4.05

const ue = unitEconomics(model)
ue.channels[0]      // { channel: "ads", cac: 200, ltv: 2769.34, ltvToCac: 13.85, paybackMonths: 2.05, … }
```

- **Zero CAC.** When a channel has no attributed spend (organic, referral), `cac` is 0, `ltvToCac` is `null` and `paybackMonths` is `null`. The warnings then include `"<id>: CAC is zero (no spend is attributed to it), so LTV:CAC is undefined and reported as null"`.
- **Capped lifetime.** When customers are still active at `meta.lifetimeCapMonths`, the warning reads `"<stream>: X% of customers are still active at the N-month lifetime cap, so LTV stops counting them; the capped value is the most the model will credit — treat it as a ceiling, not an estimate"`.

### sensitivity: `tornado`

```ts
import { tornado } from "@bib/finance/sensitivity"
tornado(model, { outcome: "endingCash", limit: 3 }).rows.map((r) => [r.path, Math.round(r.swing)])
// [["costs.headcount.eng.salary", 115200], ["costs.headcount.eng.count", 115200], ["channels.ads.unitCost.cac", 72219]]
tornado(model, { mode: "band" }).rows.map((r) => [r.path, Math.round(r.swing)])
// [["channels.ads.unitCost.cac", 115550], ["streams.core.retention.monthlyChurn", 17867]]
```

- `pct` mode (default `pct: 0.2`, so ±20%) skips inputs whose point is 0.
- `band` mode uses each band's own low and high, so it only includes inputs with a range.
- Moves are clamped to the band's limits.
- Rows are ranked by swing.
- `outcome` is any name in `OUTCOMES` or a `(projection) => number | null` function.

### paths

```ts
import { listBands, getBand, withBandPoints } from "@bib/finance/paths"
listBands(model).map((b) => b.path).slice(0, 3) // ["meta.discountRateAnnual", "streams.core.tiers.base.price", "streams.core.tiers.base.mix"]
getBand(model, "channels.ads.unitCost.cac")     // { low: 150, point: 200, high: 300, min: 0 }
withBandPoints(model, { "channels.ads.spend": 8000 }) // new model; ending customers 408.2
```

Paths use ids (`channels.ads.spend`). A numeric index (`channels.0.spend`) also works.

### monte-carlo

```ts
import { monteCarlo } from "@bib/finance/monte-carlo"
const mc = monteCarlo(model, { runs: 200, seed: 42 })
mc.sampled                 // ["streams.core.retention.monthlyChurn", "channels.ads.unitCost.cac"]
mc.outcomes.endingCash     // p10 34489, p50 59424, p90 97584 (rounded)
mc.probabilityCashOut      // 0
```

- Each run samples every band that has a range, from a triangular distribution (`low`, `point`, `high`).
- The same seed always gives the same result.
- `mc.cash` and `mc.mrr` are monthly P10/P50/P90 fan charts.

### scenarios

```ts
import { applyScenario, compareScenarios } from "@bib/finance/scenarios"
// model.scenarios = [{ id: "pricey-ads", overrides: { "channels.ads.unitCost.cac": "high" } }]
compareScenarios(withScenario).scenarios[0].headline.endingCash // 17549.67  (delta.endingCash -57774.83)
applyScenario(withScenario, "pricey-ads").channels[0].unitCost.cac.point // 300
```

### variance

```ts
import { varianceVsActuals } from "@bib/finance/variance"
// actuals: newCustomers 24 (2027-01), 26 (2027-02), 0 (2027-03)
varianceVsActuals(withActuals).metrics[0]
// { metric: "newCustomers", mape: 0.0401, withinTolerance: 1, skippedZero: 1, bias: …, points: […] }
```

- The default tolerance is ±10%.
- An actual of 0 cannot be scored as a percentage, so it is counted in `skippedZero`.
- Actuals beyond the horizon are counted in `outsideHorizon`.

### solve

```ts
import { backsolve, breakEven } from "@bib/finance/solve"
const r = backsolve(model, { path: "channels.ads.spend", outcome: "endingMrr", target: 10000, lo: 0, hi: 50000 })
// r.ok → r.value.value 1977.54, r.value.outcomeValue 9989.74 (within the default 1% tolerance)
backsolve(model, { path: "channels.ads.spend", outcome: "endingMrr", target: 1e9 })
// { ok: false, error: "search bounds are empty: lo 5000, hi 5000" }: spend is a bare number, so pass lo/hi
breakEven(project(model)) // { ebitda: null, cashFlow: null, netIncome: null }
```

- `backsolve` uses bisection.
- The search bounds default to the band's own range.
- It returns an error when the bounds don't bracket the target.

### report

```ts
import { toMoney, formatAmount, projectionToCsv, cohortsToCsv, summaryLines } from "@bib/finance/report"
toMoney(1234.565, "USD")                // { amount: 123457n, currency: "USD" }
formatAmount(1234.565, "EUR", "de-DE")  // "1.234,57 €"
formatAmount(-0.001, "USD")             // "$0.00" (never "-$0.00")
```

- `projectionToCsv` writes one row per month.
- `cohortsToCsv` writes `stream,cohort,age0,…`.
- `summaryLines` writes plain-text headlines followed by the warnings.

## CLI

```
bib-finance <command> <model.json> [options]
  summary | project (--csv, --cohorts) | economics | tornado (--outcome, --pct, --band, --limit)
  montecarlo (--runs, --seed) | compare | variance (--tolerance)
  backsolve (--path, --outcome, --target, --lo, --hi) | validate
  --scenario <id>   --json   --help   (--flag=value also works)
```

Exit codes: `0` success; `2` usage error (unknown outcome, bad number, missing
file argument); `1` unreadable file, invalid model (each issue printed as
`path: message`, or `(root)`), or a runtime failure such as a backsolve that
cannot bracket its target.

## Worked examples

The three models in [`examples/`](./examples) are runnable as they stand. The
output below is verbatim from `node dist/cli.js` on the built package. The test
suite checks that all three balance every month.

### SaaS: `examples/saas.json`

The model:

- Two tiers, with a piecewise churn curve and expansion.
- Annual prepay and a price change.
- A paid search channel, plus organic and referral.
- Headcount with hires, and support that grows with a trigger.
- An equity raise, actuals, and two scenarios.

```
$ bib-finance summary examples/saas.json
Example SaaS (24 months)
Net revenue: $1,483,912.26
Gross margin: 66.4%
EBITDA: -$2,053,501.67
Ending MRR: $129,742.22 (ARR $1,556,906.67)
Ending customers: 1359
Ending cash: $327,816.93
Lowest cash: $327,816.93 in 2028-12
Runway: 30.2 months (extrapolated)
EBITDA break-even: not within horizon

$ bib-finance economics examples/saas.json
Gross margin: 66.4%
Stream core: LTV $1,562.97, NRR 83.4%/yr, GRR 65.2%/yr
Channel search: CAC $356.16, LTV $1,562.97, LTV:CAC 4.4, payback 7.7 months
Channel organic: CAC $0.00, LTV $1,562.97, LTV:CAC n/a, payback n/a
Channel referral: CAC $0.00, LTV $1,562.97, LTV:CAC n/a, payback n/a
Blended: CAC $283.35, LTV $1,562.97, LTV:CAC 5.5
Warning: core: 14.2% of customers are still active at the 60-month lifetime cap, so LTV stops counting them; the capped value is the most the model will credit — treat it as a ceiling, not an estimate
Warning: organic: CAC is zero (no spend is attributed to it), so LTV:CAC is undefined and reported as null
Warning: referral: CAC is zero (no spend is attributed to it), so LTV:CAC is undefined and reported as null

$ bib-finance tornado examples/saas.json --band --limit 3
endingCash (base 327817), band mode:
  channels.search.unitCost.cac: 563338 .. 82919 (swing 480420)
  streams.core.tiers.pro.price: 229277 .. 426356 (swing 197079)
  streams.core.retention.segments.1.monthlyChurn: 378765 .. 250343 (swing 128422)

$ bib-finance montecarlo examples/saas.json --runs 200
200 runs, seed bib-finance, 5 uncertain inputs
Probability cash goes negative: 0%
  endingCash: P10 123983, P50 253959, P90 418973
  endingMrr: P10 104117, P50 120633, P90 143240
  …

$ bib-finance compare examples/saas.json
base: ending cash $327,816.93, ending MRR $129,742.22
downside: ending cash $31,800.92 (-$296,016.00), ending MRR $91,224.79 (-$38,517.43)
upside: ending cash $618,140.71 ($290,323.78), ending MRR $168,803.73 ($39,061.51)

$ bib-finance variance examples/saas.json
newCustomers: MAPE 34.3%, 0% within ±10% (3 points)
mrr: MAPE 4.4%, 100% within ±10% (3 points)

$ bib-finance backsolve examples/saas.json --path channels.search.spend --target 500000 --lo 0 --hi 100000
channels.search.spend = 28515.6250 gives endingCash 499263.95 (8 iterations)
```

### Marketplace: `examples/marketplace.json`

The model:

- Seller subscriptions on a survival curve.
- GMV per active seller, with a take rate and payment fees.
- A funnel-priced social channel with diminishing returns and a demand cap.
- A sales team whose loaded cost is that channel's CAC spend.
- Venture debt and a revenue-share opex line.

```
$ bib-finance summary examples/marketplace.json
Example marketplace (36 months)
Net revenue: €27,283,105.37
Gross margin: 79.6%
EBITDA: €15,422,918.69
Ending MRR: €248,703.09 (ARR €2,984,437.05)
Ending customers: 8576
Ending cash: €13,707,898.64
Lowest cash: €1,912,838.40 in 2027-02
Runway: not burning
EBITDA break-even: 2027-03

$ bib-finance economics examples/marketplace.json
Gross margin: 79.6%
Stream sellers: LTV €2,932.53, NRR 73.8%/yr, GRR 73.8%/yr
Channel social: CAC €72.21, LTV €2,932.53, LTV:CAC 40.6, payback 0.6 months
Channel field-sales: CAC €847.30, LTV €2,932.53, LTV:CAC 3.5, payback 9.7 months
Blended: CAC €153.19, LTV €2,932.53, LTV:CAC 19.1
Warning: sellers: 17.1% of customers are still active at the 60-month lifetime cap, so LTV stops counting them; the capped value is the most the model will credit — treat it as a ceiling, not an estimate
```

Stream LTV includes the GMV take per active seller. That is why it is far above
the €29 plan price.

### Services: `examples/services.json`

The model:

- Retainers with an opening book.
- Billable project hours, plus onboarding hours for each new client.
- Setup fees, contractor delivery cost, and slow payers (45-day DSO, bad debt).
- Actuals.

Month labels are `M1…`, because there is no `startMonth`.

```
$ bib-finance summary examples/services.json
Example services firm (18 months)
Net revenue: £3,039,587.43
Gross margin: 60.9%
EBITDA: £1,332,129.47
Ending MRR: £84,393.31 (ARR £1,012,719.75)
Ending customers: 28
Ending cash: £1,040,084.20
Lowest cash: £177,252.79 in M1
Runway: not burning
EBITDA break-even: M1

$ bib-finance economics examples/services.json
Gross margin: 60.9%
Stream retainers: LTV £38,918.28, NRR 54%/yr, GRR 54%/yr
Channel referrals-and-inbound: CAC £0.00, LTV £38,918.28, LTV:CAC n/a, payback n/a
Channel events: CAC £9,000.00, LTV £38,918.28, LTV:CAC 4.3, payback 2.8 months
Blended: CAC £2,057.14, LTV £38,918.28, LTV:CAC 18.9
Warning: retainers: 4.6% of customers are still active at the 60-month lifetime cap, so LTV stops counting them; the capped value is the most the model will credit — treat it as a ceiling, not an estimate
Warning: referrals-and-inbound: CAC is zero (no spend is attributed to it), so LTV:CAC is undefined and reported as null
```

## Not yet

- **Monte Carlo samples bands independently.** Correlated assumptions are not modeled (for example, higher spend usually brings higher CAC).
- **SAFEs are cash only.** Conversion, dilution and the cap table are not modeled.
- **Logo churn equals revenue churn.** Within a cohort there is no separate logo vs revenue churn beyond `expansion` and `contraction`.
- **Annual-prepaid customers churn only at renewal.** Partial refunds on cancellation are not modeled.
- **Customer counts are fractional.** Expected values are not rounded to whole customers.
- **Calculation uses floats.** Exact money applies only at output (`toMoney`, `formatAmount`). The balance check uses a small epsilon.
- **Receivables are approximated** from DSO on billings, not tracked per invoice.
- **Opening balances are limited.** There is no opening fixed-asset or debt balance: opening state is limited to `opening` plus subscription `opening` customers.
- **LTV omits some effects.** It ignores usage `unitGrowth` and uses the model's blended gross margin, not a per-stream margin.
- **Sales cost is split equally** across sales channels that share the same `role`.
- **Seasonality multipliers are not normalized.** If they don't average 1, they change annual volume.
