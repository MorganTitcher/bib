// Validates the Claude Code marketplace, every plugin manifest, and every skill's
// frontmatter against the Agent Skills spec limits. Exits non-zero on any error.
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"

const root = resolve(import.meta.dirname, "..")
const errors: string[] = []
const fail = (where: string, msg: string) => errors.push(`${where}: ${msg}`)

const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/
const MAX_NAME = 64
const MAX_DESCRIPTION = 1024
const MAX_SKILL_LINES = 500

function readJson(path: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(readFileSync(path, "utf8"))
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>
    }
    fail(path, "must be a JSON object")
  } catch (error) {
    fail(path, `unreadable JSON (${(error as Error).message})`)
  }
  return undefined
}

function checkName(where: string, name: unknown): name is string {
  if (typeof name !== "string" || !NAME.test(name) || name.length > MAX_NAME) {
    fail(
      where,
      `name must be lowercase-hyphenated and at most ${MAX_NAME} chars, got ${JSON.stringify(name)}`,
    )
    return false
  }
  return true
}

// Minimal frontmatter reader: top-level `key: value` lines between the first two `---`.
function frontmatter(text: string): Record<string, string> | undefined {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text)
  if (!match?.[1]) return undefined
  const fields: Record<string, string> = {}
  for (const line of match[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line)
    if (kv?.[1]) fields[kv[1]] = (kv[2] ?? "").replace(/^(["'])(.*)\1$/, "$2")
  }
  return fields
}

function checkSkill(dir: string, skillName: string) {
  const path = join(dir, "SKILL.md")
  if (!existsSync(path)) return fail(dir, "missing SKILL.md")
  const text = readFileSync(path, "utf8")
  const fields = frontmatter(text)
  if (!fields) return fail(path, "missing YAML frontmatter")
  if (checkName(path, fields.name) && fields.name !== skillName) {
    fail(path, `name "${fields.name}" must match its directory "${skillName}"`)
  }
  const description = fields.description ?? ""
  if (!description) fail(path, "description is required")
  if (description.length > MAX_DESCRIPTION) {
    fail(path, `description is ${description.length} chars (max ${MAX_DESCRIPTION})`)
  }
  const lines = text.split(/\r?\n/).length
  if (lines > MAX_SKILL_LINES)
    fail(path, `${lines} lines (max ${MAX_SKILL_LINES}); move detail into references/`)
}

const marketplacePath = join(root, ".claude-plugin", "marketplace.json")
const marketplace = readJson(marketplacePath)
const listed = new Set<string>()

if (marketplace) {
  checkName(marketplacePath, marketplace.name)
  const plugins = marketplace.plugins
  if (!Array.isArray(plugins) || plugins.length === 0)
    fail(marketplacePath, "plugins must be a non-empty array")
  for (const entry of Array.isArray(plugins) ? plugins : []) {
    const where = `${marketplacePath} → ${JSON.stringify(entry?.name)}`
    if (!checkName(where, entry?.name)) continue
    if (listed.has(entry.name)) fail(where, "duplicate plugin name")
    listed.add(entry.name)
    if (typeof entry.source !== "string" || !entry.source.startsWith("./")) {
      fail(where, "source must be a relative path starting with ./")
      continue
    }
    const pluginDir = join(root, entry.source)
    const manifestPath = join(pluginDir, ".claude-plugin", "plugin.json")
    const manifest = existsSync(manifestPath) ? readJson(manifestPath) : undefined
    if (!manifest) {
      fail(where, `no readable manifest at ${manifestPath}`)
      continue
    }
    if (manifest.name !== entry.name)
      fail(manifestPath, `name "${manifest.name}" must match marketplace entry "${entry.name}"`)
    if (typeof manifest.description !== "string" || !manifest.description)
      fail(manifestPath, "description is required")
    const skillsDir = join(pluginDir, "skills")
    if (!existsSync(skillsDir)) continue
    for (const skill of readdirSync(skillsDir, { withFileTypes: true })) {
      if (skill.isDirectory()) checkSkill(join(skillsDir, skill.name), skill.name)
    }
  }
}

// Every plugin directory must be reachable from the marketplace.
const pluginsRoot = join(root, "plugins")
if (existsSync(pluginsRoot)) {
  for (const dir of readdirSync(pluginsRoot, { withFileTypes: true })) {
    if (dir.isDirectory() && !listed.has(dir.name))
      fail(join(pluginsRoot, dir.name), "not listed in marketplace.json")
  }
}

if (errors.length > 0) {
  console.error(
    `✗ ${errors.length} plugin validation error(s):\n${errors.map((e) => `  - ${e}`).join("\n")}`,
  )
  process.exit(1)
}
console.log(`✓ marketplace OK: ${listed.size} plugin(s) validated`)
