// Explicit named re-exports. Each module is also its own subpath export (e.g. "@bib/finance/engine").

export { adstock, customersFromSpend, rampFactor, spendAt, unitCac } from "./acquisition.ts"
export {
  type Band,
  type BandInput,
  type BandLimits,
  band,
  bandSchema,
  bpsBand,
  clampToLimits,
  countBand,
  EVIDENCE_LEVELS,
  type Evidence,
  growthBand,
  isBand,
  isUncertain,
  moneyBand,
  type Provenance,
  ProvenanceSchema,
  rateBand,
  sampleBand,
  withPoint,
} from "./band.ts"
export {
  type CohortRow,
  channelStream,
  type MonthPointer,
  type MonthRow,
  type MrrWaterfall,
  type Projection,
  project,
  type StreamMonth,
  type Summary,
} from "./engine.ts"
export {
  isOutcome,
  OUTCOMES,
  type Outcome,
  type OutcomeSelector,
  outcomeLabel,
  outcomeValue,
  selectOutcome,
} from "./metrics.ts"
export {
  type Distribution,
  type MonteCarloOptions,
  type MonteCarloResult,
  type MonthBand,
  monteCarlo,
} from "./monte-carlo.ts"
export {
  calendarMonthOf,
  isMonthKey,
  type MonthRef,
  monthKeySchema,
  monthLabel,
  monthRefSchema,
  resolveMonth,
} from "./months.ts"
export { type BandEntry, getBand, listBands, setBandPoint, withBandPoints } from "./paths.ts"
export { cohortsToCsv, formatAmount, projectionToCsv, summaryLines, toMoney } from "./report.ts"
export {
  churnAt,
  type RetentionCurve,
  retentionSchema,
  survivalAt,
  survivalSeries,
} from "./retention.ts"
export {
  applyScenario,
  compareScenarios,
  headline,
  type ScenarioComparison,
  type ScenarioHeadline,
  type ScenarioResult,
} from "./scenarios.ts"
export {
  assertModel,
  type Channel,
  ChannelSchema,
  DEPARTMENTS,
  type Deductions,
  type Department,
  type FinanceModel,
  type FinanceModelInput,
  FinanceModelSchema,
  type FundingEventModel,
  type HeadcountRoleModel,
  idSchema,
  METRICS,
  type Metric,
  type ModelIssue,
  parseModel,
  type Stream,
  StreamSchema,
  type SubscriptionStreamModel,
} from "./schema.ts"
export { type Tornado, type TornadoOptions, type TornadoRow, tornado } from "./sensitivity.ts"
export {
  type BacksolveOptions,
  type BacksolveResult,
  type BreakEven,
  backsolve,
  breakEven,
} from "./solve.ts"
export {
  annualGrr,
  annualNrr,
  type ChannelEconomics,
  cacFromFunnel,
  type LifetimeValue,
  type LifetimeValueInput,
  lifetimeValue,
  monthlyDiscountRate,
  monthlyNrr,
  paybackMonths,
  type RetentionRates,
  ratio,
  roas,
  type StreamEconomics,
  type UnitEconomics,
  unitEconomics,
} from "./unit-economics.ts"
export {
  type MetricVariance,
  metricValue,
  type VariancePoint,
  type VarianceReport,
  varianceVsActuals,
} from "./variance.ts"
