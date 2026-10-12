import { describe, expect, it } from "vitest"
import { adstock, customersFromSpend, rampFactor, spendAt, unitCac } from "../src/acquisition.ts"
import { band } from "../src/band.ts"
import type { Channel } from "../src/schema.ts"
import { minimalModel } from "./fixtures.ts"

type PaidChannel = Extract<Channel, { type: "paid" }>

function paid(): PaidChannel {
  const channel = minimalModel().channels[0]
  if (channel?.type !== "paid") throw new Error("fixture changed")
  return channel
}

describe("acquisition", () => {
  it("computes CAC from a funnel or directly", () => {
    expect(unitCac({ kind: "cac", cac: band(120) })).toBe(120)
    expect(
      unitCac({ kind: "funnel", cpm: band(12), ctr: band(0.01), cvr: band(0.02) }),
    ).toBeCloseTo(60)
    expect(unitCac({ kind: "funnel", cpm: band(12), ctr: band(0), cvr: band(0.02) })).toBe(
      Number.POSITIVE_INFINITY,
    )
  })

  it("applies response curves", () => {
    expect(customersFromSpend(1000, 100, { kind: "linear" })).toBe(10)
    const iso = { kind: "isoelastic" as const, referenceSpend: 1000, elasticity: band(0.5) }
    expect(customersFromSpend(1000, 100, iso)).toBeCloseTo(10)
    expect(customersFromSpend(4000, 100, iso)).toBeCloseTo(20)
    const dim = { kind: "diminishing" as const, halfSaturationSpend: 1000 }
    expect(customersFromSpend(1000, 100, dim)).toBeCloseTo(5)
    expect(customersFromSpend(1e9, 100, dim)).toBeLessThan(10)
  })

  it("returns zero customers for no spend or an impossible CAC", () => {
    expect(customersFromSpend(0, 100, { kind: "linear" })).toBe(0)
    expect(customersFromSpend(100, 0, { kind: "linear" })).toBe(0)
    expect(customersFromSpend(100, Number.POSITIVE_INFINITY, { kind: "linear" })).toBe(0)
  })

  it("adstock keeps steady spend steady and ramp grows linearly", () => {
    expect(adstock(100, 100, 0.4)).toBe(100)
    expect(adstock(0, 100, 0.4)).toBe(60)
    expect(rampFactor(-1, 2)).toBe(0)
    expect(rampFactor(0, 2)).toBeCloseTo(1 / 3)
    expect(rampFactor(5, 2)).toBe(1)
    expect(rampFactor(0, 0)).toBe(1)
  })

  it("respects start, end, growth and schedule", () => {
    const channel: PaidChannel = {
      ...paid(),
      start: 2,
      end: 5,
      spendGrowth: band(0.1),
      spendSchedule: [{ month: 4, spend: band(999) }],
    }
    expect(spendAt(channel, 1)).toBe(0)
    expect(spendAt(channel, 2)).toBe(5000)
    expect(spendAt(channel, 3)).toBeCloseTo(5500)
    expect(spendAt(channel, 4)).toBe(999)
    expect(spendAt(channel, 6)).toBe(0)
  })
})
