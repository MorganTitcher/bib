import { readFileSync } from "node:fs"
import { assertModel, type FinanceModel, type FinanceModelInput } from "../src/schema.ts"

/** The smallest useful model: one subscription stream, one paid channel, nothing else. */
export function minimalInput(overrides: Partial<FinanceModelInput> = {}): FinanceModelInput {
  return {
    meta: { name: "Minimal", horizonMonths: 12 },
    opening: { cash: 100_000 },
    streams: [
      {
        type: "subscription",
        id: "core",
        tiers: [{ id: "base", price: 100, mix: 1 }],
        retention: { kind: "constant", monthlyChurn: 0.05 },
      },
    ],
    channels: [
      {
        type: "paid",
        id: "ads",
        spend: { low: 4000, point: 5000, high: 6000 },
        unitCost: { kind: "cac", cac: { low: 200, point: 250, high: 400 } },
      },
    ],
    ...overrides,
  }
}

export function minimalModel(overrides: Partial<FinanceModelInput> = {}): FinanceModel {
  return assertModel(minimalInput(overrides))
}

export function exampleText(name: string): string {
  return readFileSync(new URL(`../examples/${name}.json`, import.meta.url), "utf8")
}

export function exampleModel(name: string): FinanceModel {
  return assertModel(JSON.parse(exampleText(name)))
}

export const EXAMPLES = ["saas", "marketplace", "services"] as const
