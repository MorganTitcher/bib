# @bib/svg

Pure-TypeScript SVG tooling with no native dependencies. It covers XML escaping, a typed
string element builder, a Zod-validated declarative SVG DSL, a conservative allowlist
sanitizer, color math (hex, rgb, OKLCH, WCAG contrast), Shields-style badges, 1200x630
Open Graph card templates and BIMI SVG Tiny PS checks. Everything produces or inspects
strings. Nothing rasterizes, launches a browser or loads a font.

Runtime dependencies are `zod` (DSL only) and `@bib/shared` (`result`).

## Importing

Every module is a subpath export:

```ts
import { sanitizeSvg } from "@bib/svg/sanitize"
import { renderBadge } from "@bib/svg/badge"
```

The root `@bib/svg` barrel re-exports every public name explicitly (never `export *`).

## Maturity

The whole package is `experimental` (`"bib": { "maturity": "experimental" }`).

| Module | Status | Ported from | Notes |
|---|---|---|---|
| `escape` | experimental | Inkwell shared | Text/attribute escaping, strips XML-illegal control characters, `formatNumber` for compact coordinates |
| `element` | experimental | new | `h()` builds escaped strings. `Markup` marks trusted output; `raw()` is the only escape hatch |
| `xml` | experimental | new | Small strict XML parser that never throws. Rejects DOCTYPE/ENTITY. Supports depth and node limits. Not a general XML parser |
| `sanitize` | experimental | adsights (rewritten) | Parse-and-reserialize with a default-deny allowlist. Fails closed when input is malformed or over budget |
| `dsl` | experimental | adsights (ideas only) | Zod schemas for shapes, text, groups, gradients and viewBox. Compiled output always has `role="img"` and a `<title>` |
| `color` | experimental | Inkwell shared | Hex/rgb/OKLCH parse and format, Ottosson OKLab, chroma-reducing gamut mapping, WCAG 2 contrast |
| `text-metrics` | experimental | Inkwell (generalized) | Verdana-like width *estimates* and greedy grapheme-aware wrapping with word-boundary ellipsis |
| `badge` | experimental | Inkwell | Shields-style flat badges. Metric badges take optional color thresholds |
| `og-card` | experimental | Inkwell (generalized) | 1200x630 card template with eyebrow, title, subtitle and footer. Reports wrap/truncation and contrast results |
| `bimi` | experimental | adsights | SVG Tiny PS structural checks: root attributes, element allowlist, title, no external refs, size, square viewBox |

## Usage

Every output shown below was produced by the built package.

### escape

```ts
import { escapeXmlText, escapeXmlAttr, formatNumber } from "@bib/svg/escape"

escapeXmlText('a < b & "c"') // 'a &lt; b &amp; &quot;c&quot;'
escapeXmlAttr('x"y<') //        'x&quot;y&lt;'
formatNumber(1 / 3) //          "0.333"
```

### element

```ts
import { h, raw, svg } from "@bib/svg/element"

h("rect", { width: 10, height: 5, fill: "#000", hidden: false }).toString()
// '<rect width="10" height="5" fill="#000"/>'   (false/null/undefined attrs are dropped)

svg({ viewBox: "0 0 10 10" }, h("title", {}, "A & B"), raw("<g/>")).toString()
// '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><title>A &amp; B</title><g/></svg>'
```

Plain strings are always escaped. Only `Markup` (from `h`, `fragment`, `svg` or `raw`) is
inserted verbatim. Tag and attribute names are validated and invalid names throw.

### xml

```ts
import { parseXml, elementsOf, getAttr } from "@bib/svg/xml"

const parsed = parseXml('<svg><g id="a"/></svg>')
if (parsed.ok) {
  const root = elementsOf(parsed.nodes)[0]
  getAttr(elementsOf(root.children)[0], "id") // "a"
}
parseXml("<!DOCTYPE x><x/>") // { ok: false, error: { code: "declaration", ... } }
```

### sanitize

```ts
import { sanitizeSvg } from "@bib/svg/sanitize"

const result = sanitizeSvg(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" onload="alert(1)">' +
    '<title>Upload</title><script>alert(2)</script><a href="javascript:alert(3)"><rect width="10" height="10"/></a>' +
    '<circle cx="5" cy="5" r="4" fill="red" style="fill:url(https://evil.example/x)"/></svg>',
)
// result.ok === true
// result.svg === '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><title>Upload</title><circle cx="5" cy="5" r="4" fill="red"/></svg>'
// result.removed: onload (event-handler), script (not-allowed), a (not-allowed), style (unsafe-style)

sanitizeSvg("<!DOCTYPE svg><svg/>")
// { ok: false, svg: null, reason: "declaration", message: "DOCTYPE and ENTITY declarations are not allowed", removed: [] }

sanitizeSvg(
  '<svg xmlns="http://www.w3.org/2000/svg"><image href="data:image/png;base64,iVBORw0KGgo=" width="1" height="1"/></svg>',
  { allowImages: true },
).ok // true; base64 PNG/JPEG/GIF/WebP only, and only with allowImages
```

What it removes or rejects:

- Elements and attributes outside the allowlist. A disallowed element is dropped with its
  subtree.
- `script`, `foreignObject`, `style` elements, `on*` handlers, and `<a>` links.
- Any `href` that is not a local `#id`, except the raster data URIs above.
- `javascript:`, `vbscript:` and `data:` values in any attribute, including CSS-escaped forms.
- `url()`, `expression()`, `@import` and similar in `style` and presentation attributes.
  Local `url(#id)` stays.
- DOCTYPE and entities, `xml-stylesheet`, comments, CDATA and processing instructions.
- Duplicate or unsafe ids and dangling references.
- `<use>` cycles and expansion bombs, oversized geometry, out-of-range coordinates, and
  inputs too deep or too large.

Output is re-serialized from the parse tree and then re-checked. A residual match fails
the whole result instead of being returned.

### dsl

```ts
import { compileSvg } from "@bib/svg/dsl"

const out = compileSvg({
  width: 120,
  height: 120,
  title: "Sunrise mark",
  defs: [{ type: "linearGradient", id: "sky", x2: 0, y2: 1,
    stops: [{ offset: 0, color: "#1e3a8a" }, { offset: 1, color: "#f97316" }] }],
  children: [
    { type: "rect", width: 120, height: 120, rx: 16, fill: { ref: "sky" } },
    { type: "circle", cx: 60, cy: 74, r: 26, fill: "#fde68a" },
    { type: "text", x: 60, y: 110, content: "dawn", fontSize: 12, textAnchor: "middle", fill: "#fff" },
  ],
})
// out.ok === true; out.value is '<svg xmlns=... width="120" height="120" viewBox="0 0 120 120" role="img"><title>Sunrise mark</title><defs>...'

compileSvg({ width: 10, height: 10, title: "", children: [{ type: "circle", cx: 1, cy: 1, r: -1 }] })
// { ok: false, error: [
//   { path: "title", message: "must not be blank" },
//   { path: "children[0].r", message: "Too small: expected number to be >=0" } ] }
```

Node types are `rect`, `circle`, `ellipse`, `line`, `polyline`, `polygon`, `path`, `text`
and `g` (nested). The schema also rejects unknown keys, `{ ref }` paints to undefined
gradients, duplicate ids, and input deeper or larger than the limits. `parseSvgDocument`
validates only. `renderSvgDocument` renders an already-validated document.

### color

```ts
import { contrastRatio, meetsContrast, pickReadableText, parseOklch, oklchToRgb, toHex, rgbToOklch, parseHex, formatOklch } from "@bib/svg/color"

contrastRatio("#777777", "#ffffff") // 4.478...
meetsContrast("#777777", "#fff") //    false  (AA body text needs 4.5)
meetsContrast("#767676", "#fff") //    true
pickReadableText("#1e3a8a") //         "#ffffff"
toHex(oklchToRgb(parseOklch("oklch(60% 0.15 250)")!)) // "#2784d5"
formatOklch(rgbToOklch(parseHex("#3366cc")!)) //        "oklch(53.25% 0.1679 262.29)"
```

### text-metrics

```ts
import { estimateTextWidth, wrapText } from "@bib/svg/text-metrics"

estimateTextWidth("passing") // 41.75 (at 11px)
wrapText("The quick brown fox jumps over the lazy dog", 60, { maxLines: 2 })
// { lines: ["The quick", "brown…"], truncated: true }
```

### badge

```ts
import { renderBadge, renderMetricBadge, PERCENT_THRESHOLDS } from "@bib/svg/badge"

renderBadge({ label: "build", message: "passing", color: "green" })
// 93px-wide two-segment badge, message fill #15803d, role="img", <title>build: passing</title>

renderMetricBadge({ label: "coverage", value: 87.4, unit: "%", thresholds: PERCENT_THRESHOLDS })
// "87%" on #a16207 (75+ band); with no thresholds the color falls back to grey
```

Text colors are chosen per segment with `pickReadableText`. `badgeMinimumContrast` reports
the worst pairing.

### og-card

```ts
import { renderOgCard } from "@bib/svg/og-card"

const card = renderOgCard({ title: "Hello world", footer: "example.com" })
card.titleLines // ["Hello world"]
card.truncated //  false
card.lowContrast // []  (theme pairs below 4.5:1, if any)
card.svg //        1200x630 SVG string
```

### bimi

```ts
import { checkBimiSvg } from "@bib/svg/bimi"

checkBimiSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#fff"/></svg>')
// { ok: false, violations: [
//   { code: "version", severity: "error", ... },
//   { code: "base-profile", severity: "error", ... },
//   { code: "title", severity: "error", ... } ] }
```

## Examples

`examples/render-samples.ts` writes five SVGs to `examples/output/`:

```sh
pnpm --filter @bib/svg build
node packages/svg/examples/render-samples.ts
```

Expected output:

```
wrote badge-build.svg (575 bytes)
wrote badge-coverage.svg (571 bytes)
wrote og-card.svg (1185 bytes)
og-card: 3 title lines, truncated=false
wrote dsl-sunrise.svg (462 bytes)
wrote sanitized.svg (127 bytes)
sanitized: removed onload(event-handler), script(not-allowed), a(not-allowed), style(unsafe-style)
bimi: ok=true, violations=0
contrast #777777 on white: 4.48; text on #1e3a8a: #ffffff
```

## Limits and "Not yet"

- **No rasterization.** satori (JSX to SVG with real fonts) and resvg (SVG to PNG) are
  not included. OG cards and badges are SVG only, and many social platforms require PNG.
  Rasterize them elsewhere.
- **Text widths are estimates** from a fixed Verdana-like table. They contain no real font
  metrics, kerning or shaping. CJK and emoji use a generic width. Leave slack.
- **The sanitizer is deliberately narrow.** It drops `<a>`, `<style>`, CSS selectors,
  animation (`animate`, `set`), filters beyond the allowlist, `<image>` with remote URLs,
  and external `<use>`. Use it on untrusted uploads, not to preserve arbitrary artwork.
- **The XML parser is minimal.** It has no namespaces beyond prefixed names, no DTDs, and
  no entity definitions beyond the five predefined ones and numeric references.
- **BIMI checks are structural only.** They do not validate a VMC/CMC certificate,
  the full RNC schema, or how a mailbox provider will render the logo.
- **OKLCH gamut mapping** reduces chroma by binary search. It is not a CSS Color 4
  conformant mapping.
- The DSL has no clip paths, masks, patterns, markers or `<use>` yet.
