import { adstock, customersFromSpend, rampFactor, spendAt, unitCac } from "./acquisition.ts"
import { calendarMonthOf, monthLabel, resolveMonth } from "./months.ts"
import { churnAt } from "./retention.ts"
import type {
  Channel,
  Deductions,
  FinanceModel,
  Stream,
  SubscriptionStreamModel,
} from "./schema.ts"

/** How MRR moved in a month. `ending = starting + new + expansion - contraction - churn + priceChange`. */
export interface MrrWaterfall {
  starting: number
  new: number
  expansion: number
  contraction: number
  churn: number
  priceChange: number
  ending: number
}

/** Per subscription stream, per month. */
export interface StreamMonth {
  newCustomers: number
  activeCustomers: number
  churnedCustomers: number
  /** List MRR of the customers acquired this month, per customer. */
  newArpa: number
  mrr: MrrWaterfall
}

/** One projected month. All amounts are in major units of `meta.currency`. */
export interface MonthRow {
  index: number
  label: string
  customers: {
    new: number
    byChannel: Record<string, number>
    churned: number
    active: number
  }
  mrr: MrrWaterfall
  arr: number
  streams: Record<string, StreamMonth>
  revenue: {
    subscription: number
    usage: number
    oneTime: number
    services: number
    marketplace: number
    events: number
    /** Before discounts and refunds. */
    gross: number
    discounts: number
    refunds: number
    net: number
  }
  billings: number
  cogs: {
    payroll: number
    perCustomer: number
    revenueShare: number
    usage: number
    services: number
    paymentFees: number
    platformFees: number
    total: number
  }
  grossProfit: number
  grossMargin: number | null
  opex: {
    rd: number
    sm: number
    ga: number
    marketing: number
    payroll: number
    commissions: number
    badDebt: number
    other: number
    total: number
  }
  /** Spend attributed to each channel: paid media, or a sales role's loaded cost and commission. */
  channelSpend: Record<string, number>
  headcount: number
  ebitda: number
  depreciation: number
  interest: number
  otherIncome: number
  pretaxIncome: number
  tax: number
  netIncome: number
  cashFlow: {
    collections: number
    payments: number
    operating: number
    investing: number
    financing: number
    net: number
    /** Cash raised this month: equity, SAFEs, debt drawn, revenue-based financing and grants. */
    fundingIn: number
  }
  /** Cash consumed by operations and investment (0 when cash-flow positive). */
  burn: number
  balance: {
    cash: number
    receivables: number
    fixedAssets: number
    assets: number
    payables: number
    deferredRevenue: number
    debt: number
    liabilities: number
    equity: number
    /** `assets - liabilities - equity`. Zero up to float error; anything else is a bug. */
    check: number
  }
}

/** Customers and MRR of one acquisition cohort by age (index 0 = acquisition month). */
export interface CohortRow {
  stream: string
  /** `"opening"` for customers who existed before the projection. */
  cohort: string
  startIndex: number
  customers: number[]
  mrr: number[]
}

export interface MonthPointer {
  index: number
  label: string
}

export interface Summary {
  totals: {
    netRevenue: number
    grossProfit: number
    ebitda: number
    netIncome: number
    newCustomers: number
    marketingSpend: number
    fundingRaised: number
  }
  grossMargin: number | null
  ending: { mrr: number; arr: number; customers: number; cash: number; headcount: number }
  minCash: MonthPointer & { value: number }
  /** First month cash goes below zero. */
  cashOutMonth: MonthPointer | null
  runway: {
    months: number | null
    /**
     * `projected`: cash runs out inside the horizon. `extrapolated`: ending cash divided by
     * last month's burn, added to the horizon. `not-burning`: the last month was cash-flow positive.
     */
    basis: "projected" | "extrapolated" | "not-burning"
  }
  currentBurn: number
  /** First month from which EBITDA stays >= 0 to the end of the horizon. */
  ebitdaBreakEven: MonthPointer | null
  /** First month from which operating plus investing cash flow stays >= 0. */
  cashFlowBreakEven: MonthPointer | null
}

export interface Projection {
  name: string
  currency: string
  startMonth?: string
  months: MonthRow[]
  cohorts: CohortRow[]
  summary: Summary
  warnings: string[]
}

interface Part {
  customers: number
  mrr: number
}

interface CohortState {
  stream: string
  start: number
  opening: boolean
  monthly: Part
  prepaid: Part
  yearSurvival: number
  yearRevenue: number
  pendingPrice: number
  history: CohortRow
}

interface StreamState {
  stream: SubscriptionStreamModel
  cohorts: CohortState[]
  active: number
  newPriceFactor: number
}

interface DebtState {
  id: string
  start: number
  balance: number
  rate: number
  term: number
  interestOnly: number
  payment: number | null
}

interface RbfState {
  start: number
  remainingCap: number
  principal: number
  share: number
  cap: number
}

const DAYS_PER_MONTH = 30

function deductionsFor(model: FinanceModel, stream: Stream): Deductions {
  const base = model.revenueDeductions
  const own = stream.deductions
  return {
    discountBps: own?.discountBps ?? base.discountBps,
    refundBps: own?.refundBps ?? base.refundBps,
    paymentFeeBps: own?.paymentFeeBps ?? base.paymentFeeBps,
    platformFeeBps: own?.platformFeeBps ?? base.platformFeeBps,
  }
}

function emptyWaterfall(starting: number): MrrWaterfall {
  return {
    starting,
    new: 0,
    expansion: 0,
    contraction: 0,
    churn: 0,
    priceChange: 0,
    ending: starting,
  }
}

function listArpa(stream: SubscriptionStreamModel): number {
  let mix = 0
  let total = 0
  for (const tier of stream.tiers) {
    mix += tier.mix.point
    total += tier.price.point * tier.mix.point
  }
  // Sampled mixes need not sum to 1; normalize so ARPA stays a weighted average.
  return mix > 0 ? total / mix : 0
}

function firstSustained(values: readonly number[]): number | null {
  let index: number | null = null
  for (let i = values.length - 1; i >= 0; i--) {
    const value = values[i] ?? 0
    if (value >= 0) index = i
    else break
  }
  return index
}

/**
 * Run the model month by month.
 *
 * Every band contributes its `point`. Customer counts are expected values, so
 * they are fractional. The result is deterministic for a given model.
 */
export function project(model: FinanceModel): Projection {
  const { meta } = model
  const start = meta.startMonth
  const horizon = meta.horizonMonths
  const at = (ref: number | string) => resolveMonth(ref, start)
  const label = (index: number) => monthLabel(index, start)
  const warnings: string[] = []

  const acquisitionSeason = (m: number) =>
    model.seasonality.acquisition?.[calendarMonthOf(m, start)] ?? 1
  const volumeSeason = (m: number) => model.seasonality.volume?.[calendarMonthOf(m, start)] ?? 1

  const subscriptions = model.streams.filter(
    (s): s is SubscriptionStreamModel => s.type === "subscription",
  )
  const defaultStream = subscriptions[0]?.id
  const states = new Map<string, StreamState>()
  for (const stream of subscriptions) {
    const state: StreamState = { stream, cohorts: [], active: 0, newPriceFactor: 1 }
    if (stream.opening !== undefined && stream.opening.customers.point > 0) {
      const { customers, arpa, ageMonths } = stream.opening
      state.cohorts.push({
        stream: stream.id,
        start: -1 - ageMonths,
        opening: true,
        monthly: { customers: customers.point, mrr: customers.point * arpa.point },
        prepaid: { customers: 0, mrr: 0 },
        yearSurvival: 1,
        yearRevenue: 1,
        pendingPrice: 1,
        history: { stream: stream.id, cohort: "opening", startIndex: -1, customers: [], mrr: [] },
      })
      state.active = customers.point
    }
    states.set(stream.id, state)
  }

  // Headcount: hire cohorts per role so sales reps can ramp.
  const roleCohorts = new Map<string, { month: number; count: number }[]>()
  for (const role of model.costs.headcount) {
    const cohorts = [{ month: Number.NEGATIVE_INFINITY, count: role.count.point }]
    for (const hire of role.hires) cohorts.push({ month: at(hire.month), count: hire.count })
    roleCohorts.set(role.id, cohorts)
  }
  const salesByRole = new Map<string, string[]>()
  for (const channel of model.channels) {
    if (channel.type === "sales") {
      salesByRole.set(channel.role, [...(salesByRole.get(channel.role) ?? []), channel.id])
    }
  }

  // Channel pipelines: customers land after the sales cycle.
  const landing = new Map<string, number[]>()
  const adstockState = new Map<string, number>()
  for (const channel of model.channels)
    landing.set(
      channel.id,
      Array.from({ length: horizon }, () => 0),
    )

  const debts: DebtState[] = []
  const rbfs: RbfState[] = []
  const capex = model.costs.capex.map((c) => ({
    month: at(c.month),
    amount: c.amount.point,
    life: c.usefulLifeMonths,
  }))

  let cash = model.opening.cash
  let receivables = model.opening.receivables
  let payables = model.opening.payables
  let deferred = model.opening.deferredRevenue
  const openingRelease = model.opening.deferredRevenue / 12
  let lossCarryforward = model.opening.taxLossCarryforward
  let contributed = 0
  let retained = 0
  let fixedAssets = 0
  const openingEquity =
    model.opening.cash + model.opening.receivables - model.opening.payables - deferred

  const months: MonthRow[] = []
  let prevNewCustomers = 0
  let prevNetRevenue = 0

  for (let m = 0; m < horizon; m++) {
    // --- Headcount ---------------------------------------------------------------
    let headcount = 0
    const payrollByDept = { cogs: 0, rd: 0, sm: 0, ga: 0 }
    const rolePayroll = new Map<string, number>()
    const roleRepsEffective = new Map<string, number>()
    const activePrevTotal = [...states.values()].reduce((t, s) => t + s.active, 0)
    for (const role of model.costs.headcount) {
      const cohorts = roleCohorts.get(role.id) ?? []
      let count = cohorts.reduce((t, c) => (c.month <= m ? t + c.count : t), 0)
      if (role.trigger !== undefined) {
        const driver =
          role.trigger.metric === "activeCustomers"
            ? activePrevTotal
            : role.trigger.metric === "newCustomers"
              ? prevNewCustomers
              : prevNetRevenue
        let required = Math.ceil(driver / role.trigger.per - 1e-9)
        if (role.trigger.maxCount !== undefined)
          required = Math.min(required, role.trigger.maxCount)
        if (required > count) {
          cohorts.push({ month: m, count: required - count })
          count = required
        }
      }
      headcount += count
      const raise = (1 + role.annualRaise.point) ** Math.floor(m / 12)
      const payroll = count * (role.salary.point / 12) * raise * (1 + role.benefitsLoad.point)
      payrollByDept[role.department] += payroll
      rolePayroll.set(role.id, payroll)
      const salesChannel = model.channels.find((c) => c.type === "sales" && c.role === role.id)
      const ramp = salesChannel?.type === "sales" ? salesChannel.rampMonths : 0
      roleRepsEffective.set(
        role.id,
        cohorts.reduce(
          (t, c) => (c.month <= m ? t + c.count * rampFactor(m - c.month, ramp) : t),
          0,
        ),
      )
    }

    // --- Acquisition -------------------------------------------------------------
    const season = acquisitionSeason(m)
    const channelSpend: Record<string, number> = {}
    let marketing = 0
    for (const channel of model.channels) {
      const queue = landing.get(channel.id) ?? []
      const land = (customers: number, lag: number) => {
        const target = m + lag
        if (target < horizon) queue[target] = (queue[target] ?? 0) + customers
      }
      switch (channel.type) {
        case "paid": {
          const spend = spendAt(channel, m, start)
          channelSpend[channel.id] = spend
          marketing += spend
          const effective = adstock(
            adstockState.get(channel.id) ?? 0,
            spend,
            channel.carryover.point,
          )
          adstockState.set(channel.id, effective)
          const begin = channel.start === undefined ? 0 : at(channel.start)
          let customers =
            customersFromSpend(effective, unitCac(channel.unitCost), channel.response) *
            rampFactor(m - begin, channel.rampMonths) *
            season
          if (channel.demandCap !== undefined) {
            customers = Math.min(customers, channel.demandCap.point)
          }
          land(customers, channel.salesCycleMonths)
          break
        }
        case "organic": {
          const begin = channel.start === undefined ? 0 : at(channel.start)
          channelSpend[channel.id] = 0
          if (m >= begin) {
            land(channel.customers.point * (1 + channel.growth.point) ** (m - begin) * season, 0)
          }
          break
        }
        case "referral": {
          channelSpend[channel.id] = 0
          const base = states.get(channel.stream ?? defaultStream ?? "")?.active ?? 0
          land(channel.rate.point * base * season, 0)
          break
        }
        case "sales": {
          const reps = roleRepsEffective.get(channel.role) ?? 0
          land(reps * channel.customersPerRep.point * season, channel.salesCycleMonths)
          break
        }
      }
    }

    const byChannel: Record<string, number> = {}
    const newByStream = new Map<string, number>()
    for (const channel of model.channels) {
      const customers = landing.get(channel.id)?.[m] ?? 0
      byChannel[channel.id] = customers
      const target = channel.stream ?? defaultStream
      if (target !== undefined) newByStream.set(target, (newByStream.get(target) ?? 0) + customers)
    }

    // --- Subscription cohorts ----------------------------------------------------
    const streams: Record<string, StreamMonth> = {}
    const total = emptyWaterfall(0)
    let subscriptionRecognized = 0
    let subscriptionBillingsNet = 0
    let subscriptionDiscounts = 0
    let subscriptionRefunds = 0
    let subscriptionNet = 0
    let subscriptionPaymentFees = 0
    let subscriptionPlatformFees = 0
    let deferredChange = 0
    let churnedTotal = 0
    const newArpaByStream = new Map<string, number>()

    for (const state of states.values()) {
      const { stream } = state
      const ded = deductionsFor(model, stream)
      const discount = ded.discountBps.point / 10_000
      const refund = ded.refundBps.point / 10_000
      const keep = (1 - discount) * (1 - refund)

      let priceAll = 1
      for (const change of stream.priceChanges) {
        if (at(change.month) !== m) continue
        if (change.appliesTo === "all") priceAll *= 1 + change.pct.point
        state.newPriceFactor *= 1 + change.pct.point
      }

      const starting = state.cohorts.reduce((t, c) => t + c.monthly.mrr + c.prepaid.mrr, 0)
      const flow = emptyWaterfall(starting)
      let churned = 0
      let prepaidBillings = 0
      let prepaidRecognized = 0
      let openingMonthly = 0

      for (const cohort of state.cohorts) {
        const age = m - cohort.start
        const h = churnAt(stream.retention, age)
        const e = stream.expansion.point
        const k = stream.contraction.point
        // Monthly payers: churn, expansion and contraction all act on the starting MRR.
        const mon = cohort.monthly
        const churnMrr = mon.mrr * h
        flow.churn += churnMrr
        flow.expansion += mon.mrr * e
        flow.contraction += mon.mrr * k
        churned += mon.customers * h
        mon.customers -= mon.customers * h
        mon.mrr = Math.max(0, mon.mrr * (1 - h + e - k))
        if (priceAll !== 1) {
          flow.priceChange += mon.mrr * (priceAll - 1)
          mon.mrr *= priceAll
        }
        // Annual prepayers: the year's movement lands at each renewal.
        const pre = cohort.prepaid
        if (pre.customers > 0 || pre.mrr > 0) {
          cohort.yearSurvival *= 1 - h
          cohort.yearRevenue *= Math.max(0, 1 - h + e - k)
          cohort.pendingPrice *= priceAll
          if (age > 0 && age % 12 === 0) {
            const before = pre.mrr
            const survived = before * cohort.yearSurvival
            flow.churn += before - survived
            churned += pre.customers * (1 - cohort.yearSurvival)
            pre.customers *= cohort.yearSurvival
            const afterMovement = before * cohort.yearRevenue
            const net = afterMovement - survived
            if (net >= 0) flow.expansion += net
            else flow.contraction -= net
            pre.mrr = afterMovement * cohort.pendingPrice
            flow.priceChange += afterMovement * (cohort.pendingPrice - 1)
            cohort.yearSurvival = 1
            cohort.yearRevenue = 1
            cohort.pendingPrice = 1
            prepaidBillings += pre.mrr * 12
          }
          prepaidRecognized += pre.mrr
        }
        if (cohort.opening) openingMonthly += mon.mrr
      }

      // New cohort.
      const newCustomers = newByStream.get(stream.id) ?? 0
      const newArpa = listArpa(stream) * state.newPriceFactor
      newArpaByStream.set(stream.id, newArpa)
      if (newCustomers > 0) {
        const share = stream.annualPrepaidShare.point
        const cohort: CohortState = {
          stream: stream.id,
          start: m,
          opening: false,
          monthly: {
            customers: newCustomers * (1 - share),
            mrr: newCustomers * (1 - share) * newArpa,
          },
          prepaid: { customers: newCustomers * share, mrr: newCustomers * share * newArpa },
          yearSurvival: 1,
          yearRevenue: 1,
          pendingPrice: 1,
          history: { stream: stream.id, cohort: label(m), startIndex: m, customers: [], mrr: [] },
        }
        flow.new += newCustomers * newArpa
        prepaidBillings += cohort.prepaid.mrr * 12
        prepaidRecognized += cohort.prepaid.mrr
        state.cohorts.push(cohort)
      }

      let active = 0
      let ending = 0
      for (const cohort of state.cohorts) {
        const customers = cohort.monthly.customers + cohort.prepaid.customers
        const mrr = cohort.monthly.mrr + cohort.prepaid.mrr
        active += customers
        ending += mrr
        cohort.history.customers.push(customers)
        cohort.history.mrr.push(mrr)
      }
      flow.ending = ending
      state.active = active

      const monthlyRecognized = ending - prepaidRecognized
      const release =
        keep > 0 ? Math.min(deferred + deferredChange, openingRelease, keep * openingMonthly) : 0
      const grossBillings = monthlyRecognized + prepaidBillings
      const netRevenue = keep * ending
      subscriptionRecognized += ending
      subscriptionDiscounts += ending * discount
      subscriptionRefunds += ending * (1 - discount) * refund
      subscriptionNet += netRevenue
      subscriptionBillingsNet += keep * grossBillings - Math.max(0, release)
      deferredChange += keep * (prepaidBillings - prepaidRecognized) - Math.max(0, release)
      subscriptionPaymentFees += (netRevenue * ded.paymentFeeBps.point) / 10_000
      subscriptionPlatformFees += (netRevenue * ded.platformFeeBps.point) / 10_000
      churnedTotal += churned

      for (const key of ["new", "expansion", "contraction", "churn", "priceChange"] as const) {
        total[key] += flow[key]
      }
      total.starting += flow.starting
      total.ending += flow.ending
      streams[stream.id] = {
        newCustomers,
        activeCustomers: active,
        churnedCustomers: churned,
        newArpa,
        mrr: flow,
      }
    }
    const activeTotal = [...states.values()].reduce((t, s) => t + s.active, 0)
    const activeOf = (id: string | undefined) =>
      id === undefined ? 0 : (states.get(id)?.active ?? 0)
    const newOf = (id: string | undefined) => (id === undefined ? 0 : (newByStream.get(id) ?? 0))

    // --- Other streams -----------------------------------------------------------
    const revenue = {
      subscription: subscriptionRecognized,
      usage: 0,
      oneTime: 0,
      services: 0,
      marketplace: 0,
      events: 0,
      gross: 0,
      discounts: subscriptionDiscounts,
      refunds: subscriptionRefunds,
      net: subscriptionNet,
    }
    let billings = subscriptionBillingsNet
    let paymentFees = subscriptionPaymentFees
    let platformFees = subscriptionPlatformFees
    let usageUnits = 0
    let servicesDelivery = 0
    const volume = volumeSeason(m)

    for (const stream of model.streams) {
      if (stream.type === "subscription") continue
      let gross = 0
      switch (stream.type) {
        case "usage": {
          const growth = (1 + stream.unitGrowth.point) ** m
          const units =
            (activeOf(stream.customersOf) * stream.unitsPerCustomer.point +
              stream.baseUnits.point) *
            growth *
            volume
          usageUnits += units
          gross = units * stream.pricePerUnit.point
          revenue.usage += gross
          break
        }
        case "oneTime": {
          gross = newOf(stream.perNewCustomerOf) * stream.amount.point
          for (const row of stream.schedule) if (at(row.month) === m) gross += row.amount.point
          revenue.oneTime += gross
          break
        }
        case "services": {
          const hours =
            stream.hours.point * (1 + stream.hoursGrowth.point) ** m * volume +
            stream.hoursPerNewCustomer.point * newOf(stream.newCustomersOf)
          gross = hours * stream.rate.point
          revenue.services += gross
          break
        }
        case "marketplace": {
          const gmv =
            (stream.gmv.point * (1 + stream.gmvGrowth.point) ** m +
              stream.gmvPerActiveCustomer.point * activeOf(stream.customersOf)) *
            volume
          gross = (gmv * stream.takeRateBps.point) / 10_000
          revenue.marketplace += gross
          const base = stream.paymentFeeOn === "gmv" ? gmv : gross
          paymentFees += (base * stream.paymentFeeBps.point) / 10_000
          break
        }
      }
      const ded = deductionsFor(model, stream)
      const discount = ded.discountBps.point / 10_000
      const refund = ded.refundBps.point / 10_000
      const net = gross * (1 - discount) * (1 - refund)
      revenue.discounts += gross * discount
      revenue.refunds += gross * (1 - discount) * refund
      revenue.net += net
      billings += net
      paymentFees += (net * ded.paymentFeeBps.point) / 10_000
      platformFees += (net * ded.platformFeeBps.point) / 10_000
      if (stream.type === "services") servicesDelivery += net * stream.deliveryCostShare.point
    }
    const streamNetRevenue = revenue.net

    // --- One-off events ----------------------------------------------------------
    let eventExpense = { rd: 0, sm: 0, ga: 0 }
    let otherIncome = 0
    for (const event of model.events) {
      if (at(event.month) !== m) continue
      const amount = event.amount.point
      if (event.kind === "revenue") {
        revenue.events += amount
        revenue.net += amount
        billings += amount
      } else if (event.kind === "expense") {
        eventExpense = {
          ...eventExpense,
          [event.department]: eventExpense[event.department] + amount,
        }
      } else {
        otherIncome += amount
      }
    }
    revenue.gross = revenue.subscription + revenue.usage + revenue.oneTime + revenue.services
    revenue.gross += revenue.marketplace + revenue.events

    // --- COGS --------------------------------------------------------------------
    const cogsModel = model.costs.cogs
    const cogs = {
      payroll: payrollByDept.cogs,
      perCustomer: activeTotal * cogsModel.perActiveCustomer.point,
      revenueShare: streamNetRevenue * cogsModel.revenueShare.point,
      usage: usageUnits * cogsModel.perUsageUnit.point,
      services: servicesDelivery,
      paymentFees,
      platformFees,
      total: 0,
    }
    cogs.total =
      cogs.payroll +
      cogs.perCustomer +
      cogs.revenueShare +
      cogs.usage +
      cogs.services +
      cogs.paymentFees +
      cogs.platformFees
    const grossProfit = revenue.net - cogs.total

    // --- Opex --------------------------------------------------------------------
    let commissions = 0
    for (const role of model.costs.headcount) {
      const channels = salesByRole.get(role.id) ?? []
      let roleCommission = 0
      for (const id of channels) {
        const channel = model.channels.find((c) => c.id === id)
        const target = channel?.stream ?? defaultStream
        const arpa = target === undefined ? 0 : (newArpaByStream.get(target) ?? 0)
        roleCommission += (byChannel[id] ?? 0) * arpa * 12 * role.commissionRate.point
      }
      commissions += roleCommission
      if (channels.length > 0) {
        const loaded = (rolePayroll.get(role.id) ?? 0) + roleCommission
        for (const id of channels) channelSpend[id] = loaded / channels.length
      }
    }

    let otherOpex = { rd: 0, sm: 0, ga: 0 }
    for (const line of model.costs.opex) {
      const begin = line.start === undefined ? 0 : at(line.start)
      const end = line.end === undefined ? Number.POSITIVE_INFINITY : at(line.end)
      if (m < begin || m > end) continue
      let amount = 0
      switch (line.rule) {
        case "fixed":
          amount = line.amount.point
          break
        case "growth":
          amount = line.amount.point * (1 + line.growth.point) ** (m - begin)
          break
        case "revenueShare":
          amount = streamNetRevenue * line.share.point
          break
        case "perHead":
          amount = headcount * line.perHead.point
          break
      }
      otherOpex = { ...otherOpex, [line.department]: otherOpex[line.department] + amount }
    }

    const badDebt = (billings * model.workingCapital.badDebtBps.point) / 10_000
    const other = otherOpex.rd + otherOpex.sm + otherOpex.ga
    const events = eventExpense.rd + eventExpense.sm + eventExpense.ga
    const opex = {
      rd: payrollByDept.rd + otherOpex.rd + eventExpense.rd,
      sm: payrollByDept.sm + otherOpex.sm + eventExpense.sm + marketing + commissions,
      ga: payrollByDept.ga + otherOpex.ga + eventExpense.ga + badDebt,
      marketing,
      payroll: payrollByDept.rd + payrollByDept.sm + payrollByDept.ga,
      commissions,
      badDebt,
      other: other + events,
      total: 0,
    }
    opex.total = opex.rd + opex.sm + opex.ga
    const ebitda = grossProfit - opex.total

    // --- Capex and depreciation --------------------------------------------------
    let depreciation = 0
    let capexSpend = 0
    for (const item of capex) {
      if (item.month === m) capexSpend += item.amount
      if (m >= item.month && m < item.month + item.life) depreciation += item.amount / item.life
    }
    fixedAssets += capexSpend - depreciation

    // --- Funding -----------------------------------------------------------------
    let equityIn = 0
    let debtIn = 0
    let rbfIn = 0
    let grantIn = 0
    let interest = 0
    let principalPaid = 0
    for (const event of model.funding) {
      if (at(event.month) !== m) continue
      switch (event.type) {
        case "equity":
        case "safe":
          equityIn += event.amount.point
          break
        case "grant":
          otherIncome += event.amount.point
          grantIn += event.amount.point
          break
        case "debt":
          debtIn += event.principal.point
          debts.push({
            id: event.id,
            start: m,
            balance: event.principal.point,
            rate: event.annualRate.point / 12,
            term: event.termMonths,
            interestOnly: Math.min(event.interestOnlyMonths, event.termMonths),
            payment: null,
          })
          break
        case "rbf":
          rbfIn += event.amount.point
          rbfs.push({
            start: m,
            remainingCap: event.amount.point * event.repaymentCap,
            principal: event.amount.point,
            share: event.revenueShare.point,
            cap: event.repaymentCap,
          })
          break
      }
    }
    for (const debt of debts) {
      const elapsed = m - debt.start
      if (elapsed <= 0 || debt.balance <= 1e-9) continue
      const due = debt.balance * debt.rate
      interest += due
      if (elapsed <= debt.interestOnly) continue
      const remaining = debt.term - elapsed + 1
      if (debt.payment === null) {
        const n = debt.term - debt.interestOnly
        debt.payment =
          debt.rate === 0
            ? debt.balance / n
            : (debt.balance * debt.rate) / (1 - (1 + debt.rate) ** -n)
      }
      const principal = remaining <= 1 ? debt.balance : Math.min(debt.balance, debt.payment - due)
      debt.balance -= principal
      principalPaid += principal
    }
    for (const rbf of rbfs) {
      if (m <= rbf.start || rbf.remainingCap <= 1e-9) continue
      const payment = Math.min(Math.max(0, streamNetRevenue) * rbf.share, rbf.remainingCap)
      rbf.remainingCap -= payment
      const principal = Math.min(rbf.principal, payment / rbf.cap)
      rbf.principal -= principal
      principalPaid += principal
      interest += payment - principal
    }

    // --- Income ------------------------------------------------------------------
    const pretaxIncome = ebitda - depreciation - interest + otherIncome
    let tax = 0
    if (pretaxIncome > 0) {
      const used = Math.min(lossCarryforward, pretaxIncome)
      lossCarryforward -= used
      tax = (pretaxIncome - used) * model.taxes.rate.point
    } else {
      lossCarryforward -= pretaxIncome
    }
    const netIncome = pretaxIncome - tax

    // --- Working capital and cash ------------------------------------------------
    const receivablesEnd =
      Math.max(0, billings - badDebt) * (model.workingCapital.dsoDays.point / DAYS_PER_MONTH)
    const collections = receivables + billings - badDebt - receivablesEnd
    const payableBase = cogs.total - cogs.payroll + marketing + other + events
    const payablesEnd =
      Math.max(0, payableBase) * (model.workingCapital.dpoDays.point / DAYS_PER_MONTH)
    const cashExpenses = cogs.total + opex.total - badDebt
    const payments = cashExpenses - (payablesEnd - payables)
    const operating = collections - payments - tax - interest + otherIncome
    const investing = -capexSpend
    const financing = equityIn + debtIn + rbfIn - principalPaid
    const net = operating + investing + financing
    cash += net
    receivables = receivablesEnd
    payables = payablesEnd
    deferred += deferredChange
    contributed += equityIn
    retained += netIncome

    const debtBalance =
      debts.reduce((t, d) => t + d.balance, 0) + rbfs.reduce((t, r) => t + r.principal, 0)
    const assets = cash + receivables + fixedAssets
    const liabilities = payables + deferred + debtBalance
    const equity = openingEquity + contributed + retained

    const newCustomers = [...newByStream.values()].reduce((t, v) => t + v, 0)
    months.push({
      index: m,
      label: label(m),
      customers: { new: newCustomers, byChannel, churned: churnedTotal, active: activeTotal },
      mrr: total,
      arr: total.ending * 12,
      streams,
      revenue,
      billings,
      cogs,
      grossProfit,
      grossMargin: revenue.net === 0 ? null : grossProfit / revenue.net,
      opex,
      channelSpend,
      headcount,
      ebitda,
      depreciation,
      interest,
      otherIncome,
      pretaxIncome,
      tax,
      netIncome,
      cashFlow: {
        collections,
        payments,
        operating,
        investing,
        financing,
        net,
        fundingIn: equityIn + debtIn + rbfIn + grantIn,
      },
      burn: Math.max(0, -(operating + investing)),
      balance: {
        cash,
        receivables,
        fixedAssets,
        assets,
        payables,
        deferredRevenue: deferred,
        debt: debtBalance,
        liabilities,
        equity,
        check: assets - liabilities - equity,
      },
    })
    prevNewCustomers = newCustomers
    prevNetRevenue = revenue.net
  }

  const cohorts: CohortRow[] = []
  for (const state of states.values()) for (const c of state.cohorts) cohorts.push(c.history)

  const summary = summarize(months, model)
  if (summary.cashOutMonth !== null) {
    warnings.push(`cash goes negative in ${summary.cashOutMonth.label}`)
  }
  const worstCheck = months.reduce((w, row) => Math.max(w, Math.abs(row.balance.check)), 0)
  if (worstCheck > 0.01) warnings.push(`balance sheet is off by up to ${worstCheck.toFixed(2)}`)

  const projection: Projection = {
    name: meta.name,
    currency: meta.currency,
    months,
    cohorts,
    summary,
    warnings,
  }
  if (start !== undefined) projection.startMonth = start
  return projection
}

function pointer(months: readonly MonthRow[], index: number | null): MonthPointer | null {
  if (index === null) return null
  const row = months[index]
  return row === undefined ? null : { index, label: row.label }
}

function summarize(months: readonly MonthRow[], model: FinanceModel): Summary {
  const sum = (pick: (row: MonthRow) => number) => months.reduce((t, row) => t + pick(row), 0)
  const last = months.at(-1)
  const netRevenue = sum((r) => r.revenue.net)
  const grossProfit = sum((r) => r.grossProfit)

  let minIndex = 0
  months.forEach((row, i) => {
    if (row.balance.cash < (months[minIndex]?.balance.cash ?? Number.POSITIVE_INFINITY))
      minIndex = i
  })
  const cashOut = months.findIndex((row) => row.balance.cash < 0)
  const currentBurn = last?.burn ?? 0
  const endingCash = last?.balance.cash ?? model.opening.cash

  let runway: Summary["runway"]
  if (cashOut >= 0) runway = { months: cashOut, basis: "projected" }
  else if (currentBurn > 0) {
    runway = { months: months.length + endingCash / currentBurn, basis: "extrapolated" }
  } else runway = { months: null, basis: "not-burning" }

  const minRow = months[minIndex]
  return {
    totals: {
      netRevenue,
      grossProfit,
      ebitda: sum((r) => r.ebitda),
      netIncome: sum((r) => r.netIncome),
      newCustomers: sum((r) => r.customers.new),
      marketingSpend: sum((r) => r.opex.marketing),
      fundingRaised: sum((r) => r.cashFlow.fundingIn),
    },
    grossMargin: netRevenue === 0 ? null : grossProfit / netRevenue,
    ending: {
      mrr: last?.mrr.ending ?? 0,
      arr: last?.arr ?? 0,
      customers: last?.customers.active ?? 0,
      cash: endingCash,
      headcount: last?.headcount ?? 0,
    },
    minCash: {
      index: minIndex,
      label: minRow?.label ?? "",
      value: minRow?.balance.cash ?? endingCash,
    },
    cashOutMonth: pointer(months, cashOut >= 0 ? cashOut : null),
    runway,
    currentBurn,
    ebitdaBreakEven: pointer(months, firstSustained(months.map((r) => r.ebitda))),
    cashFlowBreakEven: pointer(
      months,
      firstSustained(months.map((r) => r.cashFlow.operating + r.cashFlow.investing)),
    ),
  }
}

/** Channels that bring customers into a stream, for callers that need the default routing. */
export function channelStream(model: FinanceModel, channel: Channel): string | undefined {
  return channel.stream ?? model.streams.find((s) => s.type === "subscription")?.id
}
