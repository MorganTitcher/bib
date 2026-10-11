#!/usr/bin/env node
import { readFileSync } from "node:fs"
import { parseArgs } from "node:util"
import { parseAssumptions } from "./assumptions.ts"
import { sensitivity } from "./scenarios.ts"
import { unitEconomics } from "./unit-economics.ts"

const USAGE = `Usage: bib-finance <assumptions.json> [--sensitivity <field>]

Reads business assumptions (JSON) and prints a unit-economics report as JSON.
With --sensitivity, scales <field> by 0.5x..1.5x and reports each scenario.`

function main(argv: string[]): number {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { sensitivity: { type: "string" }, help: { type: "boolean", short: "h" } },
  })
  const file = positionals[0]
  if (values.help || file === undefined) {
    process.stdout.write(`${USAGE}\n`)
    return file === undefined && !values.help ? 1 : 0
  }

  const assumptions = parseAssumptions(JSON.parse(readFileSync(file, "utf8")))
  const field = values.sensitivity
  if (field === undefined) {
    process.stdout.write(`${JSON.stringify(unitEconomics(assumptions), null, 2)}\n`)
    return 0
  }
  if (
    !(field in assumptions) ||
    typeof assumptions[field as keyof typeof assumptions] !== "number"
  ) {
    process.stderr.write(`Unknown numeric field: ${field}\n`)
    return 1
  }
  const rows = sensitivity(assumptions, field as Parameters<typeof sensitivity>[1])
  const summary = rows.map((row) => ({
    multiplier: row.multiplier,
    [field]: row.value,
    ...row.report.metrics,
  }))
  process.stdout.write(`${JSON.stringify({ assumptions, field, scenarios: summary }, null, 2)}\n`)
  return 0
}

try {
  process.exitCode = main(process.argv.slice(2))
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
