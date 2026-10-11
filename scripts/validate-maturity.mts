// Checks that every package states how finished it is, in two places that must agree in kind:
//   1. package.json → "bib": { "maturity": "stable" | "experimental" | "scaffold" }
//   2. README.md    → a table headed `Module | Status | Ported from | Notes` whose every Status
//                     cell is one of the same three values.
// A missing examples/ directory is reported as a warning, not an error.
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"

const root = resolve(import.meta.dirname, "..")
const packagesDir = join(root, "packages")
const MATURITY = new Set(["stable", "experimental", "scaffold"])
const HEADER = ["module", "status", "ported from", "notes"]

const errors: string[] = []
const warnings: string[] = []
const fail = (where: string, msg: string) => errors.push(`${where}: ${msg}`)

const cells = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim())

const isTableRow = (line: string) => line.trim().startsWith("|")
const isSeparator = (line: string) =>
  /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?$/.test(line.trim())

// Returns the Status cells of every maturity table in the README, or undefined if none exists.
function maturityStatuses(text: string): string[][] | undefined {
  const lines = text.split(/\r?\n/)
  const tables: string[][] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ""
    if (!isTableRow(line)) continue
    const header = cells(line).map((cell) => cell.toLowerCase())
    if (header.length !== HEADER.length || header.some((cell, k) => cell !== HEADER[k])) continue
    if (!isSeparator(lines[i + 1] ?? "")) continue
    const statuses: string[] = []
    let j = i + 2
    while (j < lines.length && isTableRow(lines[j] ?? "")) {
      statuses.push(cells(lines[j] ?? "")[1] ?? "")
      j++
    }
    tables.push(statuses)
    i = j
  }
  return tables.length > 0 ? tables : undefined
}

let checked = 0
for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  const dir = join(packagesDir, entry.name)
  const manifestPath = join(dir, "package.json")
  if (!existsSync(manifestPath)) continue
  checked++

  let manifest: { bib?: { maturity?: unknown } } = {}
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
  } catch (error) {
    fail(manifestPath, `unreadable JSON (${(error as Error).message})`)
  }
  const maturity = manifest.bib?.maturity
  if (typeof maturity !== "string" || !MATURITY.has(maturity)) {
    fail(
      manifestPath,
      `bib.maturity must be one of ${[...MATURITY].join(", ")}, got ${JSON.stringify(maturity)}`,
    )
  }

  const readmePath = join(dir, "README.md")
  if (!existsSync(readmePath)) {
    fail(dir, "missing README.md")
  } else {
    const tables = maturityStatuses(readFileSync(readmePath, "utf8"))
    if (!tables) {
      fail(readmePath, "missing a maturity table headed `Module | Status | Ported from | Notes`")
    } else {
      for (const statuses of tables) {
        if (statuses.length === 0) fail(readmePath, "maturity table has no rows")
        for (const raw of statuses) {
          const status = raw.replace(/[`*_]/g, "").trim()
          if (!MATURITY.has(status)) {
            fail(
              readmePath,
              `Status cell ${JSON.stringify(raw)} must be stable, experimental or scaffold`,
            )
          }
        }
      }
    }
  }

  if (!existsSync(join(dir, "examples"))) warnings.push(`${dir}: no examples/ directory`)
}

for (const warning of warnings) console.warn(`! ${warning}`)
if (errors.length > 0) {
  console.error(
    `✗ ${errors.length} maturity error(s):\n${errors.map((e) => `  - ${e}`).join("\n")}`,
  )
  process.exit(1)
}
console.log(`✓ maturity OK: ${checked} package(s) checked`)
