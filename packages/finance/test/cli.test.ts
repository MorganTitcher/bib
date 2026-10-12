import { describe, expect, it } from "vitest"
import { type CliIo, run, USAGE } from "../src/cli.ts"
import { exampleText } from "./fixtures.ts"

interface Captured {
  code: number
  out: string
  err: string
}

function cli(argv: string[], files: Record<string, string> = {}): Captured {
  const out: string[] = []
  const err: string[] = []
  const io: CliIo = {
    out: (t) => out.push(t),
    err: (t) => err.push(t),
    readFile: (path) => {
      const text = files[path]
      if (text === undefined) throw new Error(`ENOENT: ${path}`)
      return text
    },
  }
  const code = run(argv, io)
  return { code, out: out.join("\n"), err: err.join("\n") }
}

const FILES = {
  "saas.json": exampleText("saas"),
  "marketplace.json": exampleText("marketplace"),
  "services.json": exampleText("services"),
  "empty.json": "{}",
  "broken.json": "{ not json",
}

describe("bib-finance CLI", () => {
  it("prints usage with --help", () => {
    const r = cli(["--help"])
    expect(r.code).toBe(0)
    expect(r.out).toBe(USAGE)
  })

  it("defaults to summary", () => {
    const r = cli(["saas.json"], FILES)
    expect(r.code).toBe(0)
    expect(r.out).toContain("Net revenue: $")
    expect(r.out).toContain("Runway:")
  })

  it("prints JSON with --json", () => {
    const r = cli(["summary", "saas.json", "--json"], FILES)
    expect(r.code).toBe(0)
    const parsed = JSON.parse(r.out) as { ending: { cash: number } }
    expect(typeof parsed.ending.cash).toBe("number")
  })

  it("writes monthly CSV and cohort CSV", () => {
    const csv = cli(["project", "saas.json", "--csv"], FILES)
    expect(csv.code).toBe(0)
    expect(csv.out.split(/\r?\n/)[0]).toMatch(/^month,/)
    const cohorts = cli(["project", "saas.json", "--cohorts"], FILES)
    expect(cohorts.out.split(/\r?\n/)[0]).toMatch(/^stream,cohort,age0/)
  })

  it("reports unit economics with zero-CAC warnings", () => {
    const r = cli(["economics", "saas.json"], FILES)
    expect(r.code).toBe(0)
    expect(r.out).toContain("Channel search: CAC $")
    expect(r.out).toContain("Channel organic: CAC $0.00")
    expect(r.out).toMatch(/LTV:CAC n\/a/)
    expect(r.out).toContain("CAC is zero")
  })

  it("ranks a tornado and honors --limit and --flag=value", () => {
    const r = cli(["tornado", "saas.json", "--limit=3", "--outcome", "endingMrr"], FILES)
    expect(r.code).toBe(0)
    const rows = r.out.split("\n").filter((l) => l.startsWith("  "))
    expect(rows).toHaveLength(3)
    expect(r.out.split("\n")[0]).toMatch(/^endingMrr .*pct mode/)
  })

  it("runs a seeded Monte Carlo deterministically", () => {
    const a = cli(["montecarlo", "saas.json", "--runs", "20", "--seed", "s"], FILES)
    const b = cli(["montecarlo", "saas.json", "--runs", "20", "--seed", "s"], FILES)
    expect(a.code).toBe(0)
    expect(a.out).toBe(b.out)
    expect(a.out).toContain("20 runs, seed s")
  })

  it("compares scenarios and applies one with --scenario", () => {
    const c = cli(["compare", "saas.json"], FILES)
    expect(c.code).toBe(0)
    expect(c.out).toContain("downside:")
    expect(c.out).toContain("upside:")
    const base = cli(["summary", "saas.json", "--json"], FILES)
    const down = cli(["summary", "saas.json", "--json", "--scenario", "downside"], FILES)
    const cash = (t: string) => (JSON.parse(t) as { ending: { cash: number } }).ending.cash
    expect(cash(down.out)).toBeLessThan(cash(base.out))
    expect(cli(["summary", "saas.json", "--scenario", "nope"], FILES).code).toBe(1)
  })

  it("reports variance and handles models without actuals", () => {
    expect(cli(["variance", "saas.json"], FILES).out).toMatch(/mrr: MAPE/)
    expect(cli(["variance", "services.json"], FILES).out).toBeTruthy()
  })

  it("backsolves an input", () => {
    const r = cli(
      [
        "backsolve",
        "saas.json",
        "--path",
        "channels.search.spend",
        "--outcome",
        "totalNewCustomers",
        "--target",
        "2000",
        "--lo",
        "0",
        "--hi",
        "200000",
      ],
      FILES,
    )
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/^channels\.search\.spend = /)
  })

  it("validates a model", () => {
    const r = cli(["validate", "marketplace.json"], FILES)
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/^Model is valid\./)
  })

  it("exits 2 on usage errors", () => {
    expect(cli([]).code).toBe(2)
    expect(cli(["tornado", "saas.json", "--outcome", "bogus"], FILES).code).toBe(2)
    expect(cli(["tornado", "saas.json", "--pct", "abc"], FILES).code).toBe(2)
    expect(cli(["montecarlo", "saas.json", "--runs"], FILES).code).toBe(2)
    expect(cli(["backsolve", "saas.json", "--target", "1"], FILES).code).toBe(2)
    expect(cli(["backsolve", "saas.json", "--path", "channels.search.spend"], FILES).code).toBe(2)
  })

  it("exits 1 on unreadable files and invalid models", () => {
    const missing = cli(["missing.json"], FILES)
    expect(missing.code).toBe(1)
    expect(missing.err).toContain("could not read missing.json")
    expect(cli(["broken.json"], FILES).code).toBe(1)
    const invalid = cli(["empty.json"], FILES)
    expect(invalid.code).toBe(1)
    expect(invalid.err).toMatch(/meta|\(root\)/)
  })

  it("exits 1 when a runtime step fails", () => {
    const r = cli(["montecarlo", "saas.json", "--runs", "0"], FILES)
    expect(r.code).toBe(1)
    expect(r.err).toContain("runs must be a positive integer")
  })
})
