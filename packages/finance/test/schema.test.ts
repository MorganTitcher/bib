import { describe, expect, it } from "vitest"
import { assertModel, parseModel } from "../src/schema.ts"
import { minimalInput } from "./fixtures.ts"

function issues(input: unknown): string[] {
  const result = parseModel(input)
  return result.ok ? [] : result.error.map((i) => `${i.path}: ${i.message}`)
}

describe("parseModel", () => {
  it("fills defaults and normalizes bands", () => {
    const result = parseModel(minimalInput())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const model = result.value
    expect(model.meta.currency).toBe("USD")
    expect(model.meta.lifetimeCapMonths).toBe(60)
    expect(model.revenueDeductions.refundBps).toMatchObject({ low: 0, point: 0, high: 0 })
    expect(model.costs.cogs.perActiveCustomer.point).toBe(0)
    expect(model.funding).toEqual([])
    const stream = model.streams[0]
    expect(stream?.type === "subscription" && stream.tiers[0]?.price.point).toBe(100)
  })

  it("rejects a model with no streams", () => {
    expect(issues({ meta: { name: "x" }, streams: [] }).join("\n")).toMatch(/^streams:/m)
  })

  it("rejects a tier mix that does not sum to 1", () => {
    const input = minimalInput({
      streams: [
        {
          type: "subscription",
          id: "core",
          tiers: [
            { id: "a", price: 10, mix: 0.5 },
            { id: "b", price: 20, mix: 0.4 },
          ],
          retention: { kind: "constant", monthlyChurn: 0.05 },
        },
      ],
    })
    expect(issues(input).join("\n")).toMatch(/tier mix must sum to 1/)
  })

  it("rejects duplicate ids, unknown stream references and unknown sales roles", () => {
    const input = minimalInput({
      channels: [
        { type: "organic", id: "dup", customers: 1 },
        { type: "organic", id: "dup", customers: 1, stream: "nope" },
        { type: "sales", id: "field", role: "ae", customersPerRep: 2 },
      ],
    })
    const text = issues(input).join("\n")
    expect(text).toMatch(/duplicate id "dup"/)
    expect(text).toMatch(/"nope" is not the id of a subscription stream/)
    expect(text).toMatch(/"ae" is not a headcount role id/)
  })

  it("rejects channels without a subscription stream", () => {
    const input = minimalInput({
      streams: [{ type: "usage", id: "api", baseUnits: 100, pricePerUnit: 1 }],
    })
    expect(issues(input).join("\n")).toMatch(
      /channels acquire customers into a subscription stream/,
    )
  })

  it("rejects calendar months without startMonth", () => {
    const input = minimalInput({
      funding: [{ type: "equity", id: "seed", month: "2027-03", amount: 1 }],
    })
    expect(issues(input).join("\n")).toMatch(/needs meta.startMonth/)
  })

  it("rejects bad ids, currencies and band values", () => {
    const text = issues({
      ...minimalInput(),
      meta: { name: "x", currency: "usd" },
      revenueDeductions: { refundBps: 20_000 },
      channels: [{ type: "organic", id: "has space", customers: 1 }],
    }).join("\n")
    expect(text).toMatch(/ISO 4217/)
    expect(text).toMatch(/exceeds the maximum 10000/)
    expect(text).toMatch(/ids may contain only/)
  })

  it("checks scenario override paths", () => {
    const input = minimalInput({
      scenarios: [{ id: "s", overrides: { "channels.ads.spend": "low", "channels.ads.nope": 1 } }],
    })
    expect(issues(input)).toEqual(['scenarios.0.overrides: "channels.ads.nope" is not a band path'])
  })

  it("assertModel throws a TypeError listing issues", () => {
    expect(() => assertModel({})).toThrow(TypeError)
    expect(() => assertModel({})).toThrow(/invalid finance model/)
  })
})
