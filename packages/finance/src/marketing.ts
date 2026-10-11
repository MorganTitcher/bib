import { ratio } from "./ratio.ts"

/** Return on ad spend: attributed revenue per unit of spend. */
export function roas(attributedRevenue: number, spend: number): number | null {
  return ratio(attributedRevenue, spend)
}

/** Cost per acquisition (or per any conversion event). */
export function cpa(spend: number, conversions: number): number | null {
  return ratio(spend, conversions)
}

/** Marketing efficiency ratio: total revenue over total marketing spend, unattributed. */
export function mer(totalRevenue: number, totalMarketingSpend: number): number | null {
  return ratio(totalRevenue, totalMarketingSpend)
}

/** Cost per thousand impressions. */
export function cpm(spend: number, impressions: number): number | null {
  const value = ratio(spend, impressions)
  return value === null ? null : value * 1000
}

/** Cost per view. */
export function cpv(spend: number, views: number): number | null {
  return ratio(spend, views)
}

/** Click-through rate. */
export function ctr(clicks: number, impressions: number): number | null {
  return ratio(clicks, impressions)
}

/** Conversion rate. */
export function conversionRate(conversions: number, visitors: number): number | null {
  return ratio(conversions, visitors)
}

/** ROAS needed to break even on contribution, given gross margin. */
export function breakevenRoas(grossMargin: number): number | null {
  return ratio(1, grossMargin)
}

/**
 * Walk a funnel from spend to customers.
 *
 * Each stage rate is a fraction; the result lists the volume at every stage and
 * the resulting cost per customer.
 */
export function funnel(input: {
  spend: number
  cpm: number
  ctr: number
  landingToLead: number
  leadToCustomer: number
}): {
  impressions: number
  clicks: number
  leads: number
  customers: number
  costPerCustomer: number | null
} {
  const impressions = input.cpm > 0 ? (input.spend / input.cpm) * 1000 : 0
  const clicks = impressions * input.ctr
  const leads = clicks * input.landingToLead
  const customers = leads * input.leadToCustomer
  return { impressions, clicks, leads, customers, costPerCustomer: ratio(input.spend, customers) }
}
