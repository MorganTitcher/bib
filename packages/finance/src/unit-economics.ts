import { type Projection, project } from "./engine.ts"
import { churnAt, type RetentionCurve } from "./retention.ts"
import type {
  Channel,
  Deductions,
  FinanceModel,
  Stream,
  SubscriptionStreamModel,
} from "./schema.ts"

/** Monthly movement rates of a revenue base, all as fractions of the starting base. */
export interface RetentionRates {
  monthlyChurn: number
  expansion: number
  contraction?: number
}

/**
 * Monthly net revenue retention: `1 - churn + expansion - contraction`.
 *
 * Expansion is measured on the month's starting base, the same base churn comes
 * out of, so the terms add. 2% churn with 3% expansion is 101%, not
 * `0.98 × 1.03 = 100.94%`.
 */
export function monthlyNrr(rates: RetentionRates): number {
  return 1 - rates.monthlyChurn + rates.expansion - (rates.contraction ?? 0)
}

/** Twelve months of {@link monthlyNrr}, compounded. */
export function annualNrr(rates: RetentionRates): number {
  return Math.max(0, monthlyNrr(rates)) ** 12
}

/** Gross revenue retention over a year: churn and contraction only, no expansion. */
export function annualGrr(rates: RetentionRates): number {
  return Math.max(0, 1 - rates.monthlyChurn - (rates.contraction ?? 0)) ** 12
}

/** `a / b`, or `null` when `b` is 0 or either side is not finite. */
export function ratio(a: number, b: number): number | null {
  if (b === 0 || !Number.isFinite(a) || !Number.isFinite(b)) return null
  return a / b
}

/** CAC of an ad funnel: `cpm / 1000 / (ctr × cvr)`. `null` when nothing converts. */
export function cacFromFunnel(funnel: { cpm: number; ctr: number; cvr: number }): number | null {
  return ratio(funnel.cpm / 1000, funnel.ctr * funnel.cvr)
}

/** Return on ad spend. `null` with no spend. */
export function roas(revenue: number, spend: number): number | null {
  return ratio(revenue, spend)
}

/** Convert an annual discount rate to the equivalent monthly one. */
export function monthlyDiscountRate(annual: number): number {
  return (1 + annual) ** (1 / 12) - 1
}

export interface LifetimeValueInput {
  /** Net subscription revenue per customer in the acquisition month. */
  arpa: number
  grossMargin: number
  retention: RetentionCurve
  expansion?: number
  contraction?: number
  /** Net non-subscription revenue per surviving customer per month (usage, marketplace). */
  otherPerActive?: number
  /** Net revenue collected once at acquisition (setup fees, onboarding services). */
  upfront?: number
  capMonths: number
  monthlyDiscountRate?: number
}

export interface LifetimeValue {
  ltv: number
  /** Share of customers still active when the cap cuts the sum off. */
  survivalAtCap: number
  /** Undiscounted gross profit per acquired customer by age, starting at age 0. */
  contribution: number[]
  /** Gross profit of `upfront`. */
  upfrontContribution: number
}

/**
 * Gross-profit lifetime value of one acquired customer:
 * `upfront × GM + Σ_{a < cap} (arpa × r(a) + other × S(a)) × GM / (1 + d)^a`,
 * where `S` is logo survival and `r` is revenue retention (survival plus
 * expansion, minus contraction). Age 0 is the acquisition month.
 */
export function lifetimeValue(input: LifetimeValueInput): LifetimeValue {
  const e = input.expansion ?? 0
  const k = input.contraction ?? 0
  const d = input.monthlyDiscountRate ?? 0
  const other = input.otherPerActive ?? 0
  const upfrontContribution = (input.upfront ?? 0) * input.grossMargin
  let revenueRetention = 1
  let survival = 1
  let ltv = upfrontContribution
  const contribution: number[] = []
  for (let age = 0; age < input.capMonths; age++) {
    if (age > 0) {
      const h = churnAt(input.retention, age)
      revenueRetention *= Math.max(0, 1 - h + e - k)
      survival *= 1 - h
    }
    const value = (input.arpa * revenueRetention + other * survival) * input.grossMargin
    contribution.push(value)
    ltv += value / (1 + d) ** age
  }
  const survivalAtCap = survival * (1 - churnAt(input.retention, input.capMonths))
  return { ltv, survivalAtCap, contribution, upfrontContribution }
}

/**
 * Months of gross profit needed to earn back `cac`, interpolated within the
 * month it happens. `0` when the upfront contribution already covers it;
 * `null` when it never does within the contribution series.
 */
export function paybackMonths(
  cac: number,
  contribution: readonly number[],
  upfrontContribution = 0,
): number | null {
  if (cac <= upfrontContribution) return 0
  let cumulative = upfrontContribution
  for (let i = 0; i < contribution.length; i++) {
    const value = contribution[i] ?? 0
    if (value > 0 && cumulative + value >= cac) return i + (cac - cumulative) / value
    cumulative += value
  }
  return null
}

export interface ChannelEconomics {
  channel: string
  type: Channel["type"] | "blended"
  stream: string | undefined
  newCustomers: number
  /** Spend attributed over the horizon: media for paid channels, loaded cost for sales. */
  spend: number
  cac: number | null
  ltv: number | null
  ltvToCac: number | null
  paybackMonths: number | null
  warnings: string[]
}

export interface StreamEconomics {
  stream: string
  /** Net subscription revenue per new customer in its first month. */
  arpa: number
  otherPerActive: number
  upfront: number
  ltv: number
  survivalAtCap: number
  nrrMonthly: number
  nrrAnnual: number
  grrAnnual: number
}

export interface UnitEconomics {
  grossMargin: number
  monthlyDiscountRate: number
  lifetimeCapMonths: number
  streams: StreamEconomics[]
  channels: ChannelEconomics[]
  blended: ChannelEconomics
  warnings: string[]
}

function keepFactor(model: FinanceModel, stream: Stream): number {
  const base: Deductions = model.revenueDeductions
  const discount = (stream.deductions?.discountBps ?? base.discountBps).point / 10_000
  const refund = (stream.deductions?.refundBps ?? base.refundBps).point / 10_000
  return (1 - discount) * (1 - refund)
}

function streamEconomics(
  model: FinanceModel,
  projection: Projection,
  stream: SubscriptionStreamModel,
  grossMargin: number,
  d: number,
): StreamEconomics {
  let customers = 0
  let mrr = 0
  let lastArpa = 0
  for (const row of projection.months) {
    const month = row.streams[stream.id]
    if (month === undefined) continue
    customers += month.newCustomers
    mrr += month.newCustomers * month.newArpa
    lastArpa = month.newArpa
  }
  const arpa = (customers > 0 ? mrr / customers : lastArpa) * keepFactor(model, stream)

  let otherPerActive = 0
  let upfront = 0
  for (const other of model.streams) {
    const keep = keepFactor(model, other)
    if (other.type === "usage" && other.customersOf === stream.id) {
      otherPerActive += other.unitsPerCustomer.point * other.pricePerUnit.point * keep
    } else if (other.type === "marketplace" && other.customersOf === stream.id) {
      otherPerActive +=
        ((other.gmvPerActiveCustomer.point * other.takeRateBps.point) / 10_000) * keep
    } else if (other.type === "oneTime" && other.perNewCustomerOf === stream.id) {
      upfront += other.amount.point * keep
    } else if (other.type === "services" && other.newCustomersOf === stream.id) {
      upfront += other.hoursPerNewCustomer.point * other.rate.point * keep
    }
  }

  const value = lifetimeValue({
    arpa,
    grossMargin,
    retention: stream.retention,
    expansion: stream.expansion.point,
    contraction: stream.contraction.point,
    otherPerActive,
    upfront,
    capMonths: model.meta.lifetimeCapMonths,
    monthlyDiscountRate: d,
  })
  // Steady-state churn: the curve's rate one year in.
  const rates = {
    monthlyChurn: churnAt(stream.retention, 13),
    expansion: stream.expansion.point,
    contraction: stream.contraction.point,
  }
  return {
    stream: stream.id,
    arpa,
    otherPerActive,
    upfront,
    ltv: value.ltv,
    survivalAtCap: value.survivalAtCap,
    nrrMonthly: monthlyNrr(rates),
    nrrAnnual: annualNrr(rates),
    grrAnnual: annualGrr(rates),
  }
}

function contributionFor(
  model: FinanceModel,
  economics: StreamEconomics,
  grossMargin: number,
): { contribution: number[]; upfront: number } {
  const stream = model.streams.find(
    (s): s is SubscriptionStreamModel => s.type === "subscription" && s.id === economics.stream,
  )
  if (stream === undefined) return { contribution: [], upfront: 0 }
  const value = lifetimeValue({
    arpa: economics.arpa,
    grossMargin,
    retention: stream.retention,
    expansion: stream.expansion.point,
    contraction: stream.contraction.point,
    otherPerActive: economics.otherPerActive,
    upfront: economics.upfront,
    capMonths: model.meta.lifetimeCapMonths,
  })
  return { contribution: value.contribution, upfront: value.upfrontContribution }
}

/**
 * CAC, LTV, LTV:CAC and payback for every channel plus a blended row.
 *
 * LTV is gross-profit LTV using the projection's blended gross margin, summed
 * over at most `meta.lifetimeCapMonths` and discounted at
 * `meta.discountRateAnnual`. CAC is the channel's attributed spend over the
 * horizon divided by the customers it delivered in the horizon.
 */
export function unitEconomics(model: FinanceModel, projection = project(model)): UnitEconomics {
  const warnings: string[] = []
  const margin = projection.summary.grossMargin
  let grossMargin = margin ?? 0
  if (margin === null) {
    warnings.push("the projection has no revenue, so gross margin is unknown; LTV is reported as 0")
  } else if (margin <= 0) {
    warnings.push(
      `gross margin is ${(margin * 100).toFixed(1)}%, so every customer loses money and LTV is not positive`,
    )
    grossMargin = margin
  }
  const d = monthlyDiscountRate(model.meta.discountRateAnnual.point)
  const cap = model.meta.lifetimeCapMonths

  const streams = model.streams
    .filter((s): s is SubscriptionStreamModel => s.type === "subscription")
    .map((s) => streamEconomics(model, projection, s, grossMargin, d))
  for (const s of streams) {
    if (s.survivalAtCap > 0.01) {
      warnings.push(
        `${s.stream}: ${(s.survivalAtCap * 100).toFixed(1)}% of customers are still active at the ` +
          `${cap}-month lifetime cap, so LTV stops counting them; the capped value is the most the ` +
          "model will credit — treat it as a ceiling, not an estimate",
      )
    }
  }
  const byStream = new Map(streams.map((s) => [s.stream, s]))
  const defaultStream = streams[0]?.stream

  const rows: ChannelEconomics[] = model.channels.map((channel) => {
    const target = channel.stream ?? defaultStream
    let newCustomers = 0
    let spend = 0
    for (const row of projection.months) {
      newCustomers += row.customers.byChannel[channel.id] ?? 0
      spend += row.channelSpend[channel.id] ?? 0
    }
    const economics = target === undefined ? undefined : byStream.get(target)
    return economicsRow(
      model,
      channel.id,
      channel.type,
      target,
      newCustomers,
      spend,
      economics,
      grossMargin,
    )
  })

  const totalCustomers = rows.reduce((t, r) => t + r.newCustomers, 0)
  const totalSpend = rows.reduce((t, r) => t + r.spend, 0)
  const blendedLtv =
    totalCustomers > 0
      ? rows.reduce((t, r) => t + (r.ltv ?? 0) * r.newCustomers, 0) / totalCustomers
      : (streams[0]?.ltv ?? null)
  const blended = economicsRow(
    model,
    "blended",
    "blended",
    undefined,
    totalCustomers,
    totalSpend,
    // With one subscription stream every channel shares its retention, so payback is defined.
    streams.length === 1 ? streams[0] : undefined,
    grossMargin,
    blendedLtv,
  )

  for (const row of [...rows, blended]) warnings.push(...row.warnings)
  return {
    grossMargin,
    monthlyDiscountRate: d,
    lifetimeCapMonths: cap,
    streams,
    channels: rows,
    blended,
    warnings,
  }
}

function economicsRow(
  model: FinanceModel,
  id: string,
  type: ChannelEconomics["type"],
  stream: string | undefined,
  newCustomers: number,
  spend: number,
  economics: StreamEconomics | undefined,
  grossMargin: number,
  ltvOverride?: number | null,
): ChannelEconomics {
  const warnings: string[] = []
  const ltv = ltvOverride !== undefined ? ltvOverride : (economics?.ltv ?? null)
  let cac: number | null = null
  let ltvToCac: number | null = null
  let payback: number | null = null
  if (newCustomers <= 0) {
    warnings.push(`${id}: no customers were acquired in the horizon, so CAC is undefined`)
  } else {
    cac = spend / newCustomers
    if (cac === 0) {
      warnings.push(
        `${id}: CAC is zero (no spend is attributed to it), so LTV:CAC is undefined and reported as null`,
      )
    } else {
      ltvToCac = ltv === null ? null : ratio(ltv, cac)
      if (economics !== undefined) {
        const { contribution, upfront } = contributionFor(model, economics, grossMargin)
        payback = paybackMonths(cac, contribution, upfront)
        if (payback === null) {
          warnings.push(
            `${id}: CAC is not earned back within the ${model.meta.lifetimeCapMonths}-month lifetime cap`,
          )
        }
      }
    }
  }
  return {
    channel: id,
    type,
    stream,
    newCustomers,
    spend,
    cac,
    ltv,
    ltvToCac,
    paybackMonths: payback,
    warnings,
  }
}
