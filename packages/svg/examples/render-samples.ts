// Writes sample SVGs to examples/output/. Run after building the package:
//
//   pnpm --filter @bib/svg build
//   node packages/svg/examples/render-samples.ts
//
// Node 24 strips the type annotations; the import resolves the built dist.
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  checkBimiSvg,
  compileSvg,
  contrastRatio,
  PERCENT_THRESHOLDS,
  pickReadableText,
  renderBadge,
  renderMetricBadge,
  renderOgCard,
  sanitizeSvg,
} from "../dist/index.js"

const outDir = join(dirname(fileURLToPath(import.meta.url)), "output")
mkdirSync(outDir, { recursive: true })

function write(name: string, svg: string): void {
  writeFileSync(join(outDir, name), `${svg}\n`)
  console.log(`wrote ${name} (${svg.length} bytes)`)
}

write("badge-build.svg", renderBadge({ label: "build", message: "passing", color: "green" }))
write(
  "badge-coverage.svg",
  renderMetricBadge({ label: "coverage", value: 87.4, unit: "%", thresholds: PERCENT_THRESHOLDS }),
)

const card = renderOgCard({
  eyebrow: "Engineering",
  title: "Rendering share cards without a headless browser or native image libraries",
  subtitle: "Plain SVG strings, estimated text widths, and greedy line wrapping.",
  footer: "example.com/blog",
})
write("og-card.svg", card.svg)
console.log(`og-card: ${card.titleLines.length} title lines, truncated=${card.truncated}`)

const compiled = compileSvg({
  width: 120,
  height: 120,
  title: "Sunrise mark",
  defs: [
    {
      type: "linearGradient",
      id: "sky",
      x2: 0,
      y2: 1,
      stops: [
        { offset: 0, color: "#1e3a8a" },
        { offset: 1, color: "#f97316" },
      ],
    },
  ],
  children: [
    { type: "rect", width: 120, height: 120, rx: 16, fill: { ref: "sky" } },
    { type: "circle", cx: 60, cy: 74, r: 26, fill: "#fde68a" },
    {
      type: "text",
      x: 60,
      y: 110,
      content: "dawn",
      fontSize: 12,
      textAnchor: "middle",
      fill: "#fff",
    },
  ],
})
if (!compiled.ok) throw new Error(JSON.stringify(compiled.error))
write("dsl-sunrise.svg", compiled.value)

const hostile =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" onload="alert(1)">' +
  '<title>Upload</title><script>alert(2)</script><a href="javascript:alert(3)"><rect width="10" height="10"/></a>' +
  '<circle cx="5" cy="5" r="4" fill="red" style="fill:url(https://evil.example/x)"/></svg>'
const cleaned = sanitizeSvg(hostile)
if (!cleaned.ok) throw new Error(cleaned.message)
write("sanitized.svg", cleaned.svg)
console.log(`sanitized: removed ${cleaned.removed.map((r) => `${r.name}(${r.reason})`).join(", ")}`)

const bimi = checkBimiSvg(
  '<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny-ps" viewBox="0 0 100 100">' +
    '<title>Example Co</title><rect width="100" height="100" fill="#ffffff"/>' +
    '<circle cx="50" cy="50" r="30" fill="#1d4ed8"/></svg>',
)
console.log(`bimi: ok=${bimi.ok}, violations=${bimi.violations.length}`)
console.log(
  `contrast #777777 on white: ${contrastRatio("#777777", "#ffffff").toFixed(2)}; text on #1e3a8a: ${pickReadableText("#1e3a8a")}`,
)
