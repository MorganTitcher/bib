#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { formatPercent } from "@bib/shared/format"
import { project } from "./engine.ts"
import { isOutcome, OUTCOMES } from "./metrics.ts"
import { monteCarlo } from "./monte-carlo.ts"
import { cohortsToCsv, formatAmount, projectionToCsv, summaryLines } from "./report.ts"
import { applyScenario, compareScenarios } from "./scenarios.ts"
import { type FinanceModel, parseModel } from "./schema.ts"
import { tornado } from "./sensitivity.ts"
import { backsolve } from "./solve.ts"
import { unitEconomics } from "./unit-economics.ts"
import { varianceVsActuals } from "./variance.ts"

export const USAGE = `Usage: bib-finance <command> <model.json> [options]

Commands:
  summary      Headline numbers and warnings (default)
  project      Monthly P&L, cash flow and balance (--csv, --cohorts)
  economics    CAC, LTV, LTV:CAC and payback per channel
  tornado      Rank inputs by how much they move an outcome (--outcome, --pct, --band, --limit)
  montecarlo   P10/P50/P90 from sampling every band (--runs, --seed)
  compare      Base model against each scenario
  variance     Projection against actuals (--tolerance)
  backsolve    Solve an input for a target (--path, --outcome, --target, --lo, --hi)
  validate     Check the model and list problems

Options:
  --scenario <id>  Apply a scenario first
  --json           Print JSON instead of text
Outcomes: ${OUTCOMES.join(", ")}`

const COMMANDS = [
  "summary",
  "project",
  "economics",
  "tornado",
  "montecarlo",
  "compare",
  "variance",
  "backsolve",
  "validate",
] as const
type Command = (typeof COMMANDS)[number]
const BOOLEAN_FLAGS = new Set(["json", "csv", "cohorts", "band", "help"])

export interface CliIo {
  out: (text: string) => void
  err: (text: string) => void
  readFile: (path: string) => string
}

interface Parsed {
  command: Command
  file: string | undefined
  flags: Map<string, string | true>
}

function parseArgs(argv: readonly string[]): Parsed | string {
  const positional: string[] = []
  const flags = new Map<string, string | true>()
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? ""
    if (arg.startsWith("--")) {
      const [name = "", inline] = arg.slice(2).split("=", 2)
      if (BOOLEAN_FLAGS.has(name)) flags.set(name, true)
      else if (inline !== undefined) flags.set(name, inline)
      else {
        const value = argv[i + 1]
        if (value === undefined) return `--${name} needs a value`
        flags.set(name, value)
        i++
      }
    } else positional.push(arg)
  }
  const [first, second] = positional
  if (first !== undefined && (COMMANDS as readonly string[]).includes(first)) {
    return { command: first as Command, file: second, flags }
  }
  return { command: "summary", file: first, flags }
}

function numberFlag(flags: Map<string, string | true>, name: string): number | undefined | string {
  const raw = flags.get(name)
  if (raw === undefined) return undefined
  const value = Number(raw)
  return typeof raw === "string" && raw.trim() !== "" && Number.isFinite(value)
    ? value
    : `--${name} must be a number`
}

const fmtNumber = (v: number | null, digits = 1) => (v === null ? "n/a" : v.toFixed(digits))

/** Run the CLI. Returns the process exit code. */
export function run(argv: readonly string[], io: CliIo): number {
  const parsed = parseArgs(argv)
  if (typeof parsed === "string") {
    io.err(`${parsed}\n\n${USAGE}`)
    return 2
  }
  const { command, file, flags } = parsed
  if (flags.has("help")) {
    io.out(USAGE)
    return 0
  }
  if (file === undefined) {
    io.err(`missing model file\n\n${USAGE}`)
    return 2
  }
  let raw: unknown
  try {
    raw = JSON.parse(io.readFile(file))
  } catch (cause) {
    io.err(`could not read ${file}: ${cause instanceof Error ? cause.message : String(cause)}`)
    return 1
  }
  const result = parseModel(raw)
  if (!result.ok) {
    for (const issue of result.error) io.err(`${issue.path || "(root)"}: ${issue.message}`)
    return 1
  }
  const json = flags.has("json")
  const print = (value: unknown, text: () => string[]) =>
    io.out(json ? JSON.stringify(value, null, 2) : text().join("\n"))

  try {
    let model: FinanceModel = result.value
    const scenario = flags.get("scenario")
    if (typeof scenario === "string") model = applyScenario(model, scenario)
    const currency = model.meta.currency
    const money = (v: number | null) => (v === null ? "n/a" : formatAmount(v, currency))

    switch (command) {
      case "validate": {
        const projection = project(model)
        print({ valid: true, warnings: projection.warnings }, () => [
          "Model is valid.",
          ...projection.warnings.map((w) => `Warning: ${w}`),
        ])
        return 0
      }
      case "summary": {
        const projection = project(model)
        print(projection.summary, () => summaryLines(projection))
        return 0
      }
      case "project": {
        const projection = project(model)
        if (flags.has("cohorts")) io.out(cohortsToCsv(projection.cohorts))
        else if (flags.has("csv")) io.out(projectionToCsv(projection))
        else print(projection, () => [projectionToCsv(projection)])
        return 0
      }
      case "economics": {
        const ue = unitEconomics(model)
        print(ue, () => [
          `Gross margin: ${formatPercent(ue.grossMargin)}`,
          ...ue.streams.map(
            (s) =>
              `Stream ${s.stream}: LTV ${money(s.ltv)}, NRR ${formatPercent(s.nrrAnnual)}/yr, GRR ${formatPercent(s.grrAnnual)}/yr`,
          ),
          ...ue.channels.map(
            (c) =>
              `Channel ${c.channel}: CAC ${money(c.cac)}, LTV ${money(c.ltv)}, LTV:CAC ${fmtNumber(c.ltvToCac)}, payback ${c.paybackMonths === null ? "n/a" : `${c.paybackMonths.toFixed(1)} months`}`,
          ),
          `Blended: CAC ${money(ue.blended.cac)}, LTV ${money(ue.blended.ltv)}, LTV:CAC ${fmtNumber(ue.blended.ltvToCac)}`,
          ...ue.warnings.map((w) => `Warning: ${w}`),
        ])
        return 0
      }
      case "tornado": {
        const outcome = flags.get("outcome") ?? "endingCash"
        if (typeof outcome !== "string" || !isOutcome(outcome)) {
          io.err(`unknown outcome: ${String(outcome)}`)
          return 2
        }
        const pct = numberFlag(flags, "pct")
        const limit = numberFlag(flags, "limit")
        if (typeof pct === "string" || typeof limit === "string") {
          io.err(typeof pct === "string" ? pct : String(limit))
          return 2
        }
        const t = tornado(model, {
          outcome,
          mode: flags.has("band") ? "band" : "pct",
          ...(pct === undefined ? {} : { pct }),
          ...(limit === undefined ? {} : { limit }),
        })
        print(t, () => [
          `${t.outcome} (base ${fmtNumber(t.baseValue, 0)}), ${t.mode} mode:`,
          ...t.rows.map(
            (r) =>
              `  ${r.path}: ${fmtNumber(r.lowValue, 0)} .. ${fmtNumber(r.highValue, 0)} (swing ${fmtNumber(r.swing, 0)})`,
          ),
        ])
        return 0
      }
      case "montecarlo": {
        const runs = numberFlag(flags, "runs")
        if (typeof runs === "string") {
          io.err(runs)
          return 2
        }
        const seed = flags.get("seed")
        const mc = monteCarlo(model, {
          ...(runs === undefined ? {} : { runs }),
          ...(typeof seed === "string" ? { seed } : {}),
        })
        print(mc, () => [
          `${mc.runs} runs, seed ${mc.seed}, ${mc.sampled.length} uncertain inputs`,
          `Probability cash goes negative: ${formatPercent(mc.probabilityCashOut)}`,
          ...Object.entries(mc.outcomes).map(
            ([name, d]) =>
              `  ${name}: P10 ${fmtNumber(d.p10, 0)}, P50 ${fmtNumber(d.p50, 0)}, P90 ${fmtNumber(d.p90, 0)}`,
          ),
        ])
        return 0
      }
      case "compare": {
        const c = compareScenarios(model)
        print(c, () => [
          `base: ending cash ${money(c.base.headline.endingCash)}, ending MRR ${money(c.base.headline.endingMrr)}`,
          ...c.scenarios.map(
            (s) =>
              `${s.id}: ending cash ${money(s.headline.endingCash)} (${money(s.delta.endingCash)}), ending MRR ${money(s.headline.endingMrr)} (${money(s.delta.endingMrr)})`,
          ),
        ])
        return 0
      }
      case "variance": {
        const tolerance = numberFlag(flags, "tolerance")
        if (typeof tolerance === "string") {
          io.err(tolerance)
          return 2
        }
        const v = varianceVsActuals(model, project(model), {
          ...(tolerance === undefined ? {} : { tolerance }),
        })
        print(v, () =>
          v.metrics.length === 0
            ? ["No actuals in the model."]
            : v.metrics.map(
                (m) =>
                  `${m.metric}: MAPE ${m.mape === null ? "n/a" : formatPercent(m.mape)}, ${m.withinTolerance === null ? "n/a" : formatPercent(m.withinTolerance)} within ±${formatPercent(v.tolerance)} (${m.points.length} points)`,
              ),
        )
        return 0
      }
      case "backsolve": {
        const path = flags.get("path")
        const outcome = flags.get("outcome") ?? "endingCash"
        const target = numberFlag(flags, "target")
        const lo = numberFlag(flags, "lo")
        const hi = numberFlag(flags, "hi")
        if (typeof path !== "string") {
          io.err("--path is required")
          return 2
        }
        if (typeof outcome !== "string" || !isOutcome(outcome)) {
          io.err(`unknown outcome: ${String(outcome)}`)
          return 2
        }
        if (target === undefined || typeof target === "string") {
          io.err(target ?? "--target is required")
          return 2
        }
        if (typeof lo === "string" || typeof hi === "string") {
          io.err(typeof lo === "string" ? lo : String(hi))
          return 2
        }
        const solved = backsolve(model, {
          path,
          outcome,
          target,
          ...(lo === undefined ? {} : { lo }),
          ...(hi === undefined ? {} : { hi }),
        })
        if (!solved.ok) {
          io.err(solved.error)
          return 1
        }
        const { model: _model, ...rest } = solved.value
        print(rest, () => [
          `${path} = ${rest.value.toFixed(4)} gives ${outcome} ${rest.outcomeValue.toFixed(2)} (${rest.iterations} iterations)`,
        ])
        return 0
      }
    }
  } catch (cause) {
    io.err(cause instanceof Error ? cause.message : String(cause))
    return 1
  }
}

function isEntryPoint(): boolean {
  const entry = process.argv[1]
  if (entry === undefined) return false
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (isEntryPoint()) {
  process.exitCode = run(process.argv.slice(2), {
    out: (text) => process.stdout.write(`${text}\n`),
    err: (text) => process.stderr.write(`${text}\n`),
    readFile: (path) => readFileSync(path, "utf8"),
  })
}
