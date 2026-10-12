/**
 * Read the built token set and print the brand colours and spacing scale.
 *
 * Run after building:
 *
 *   pnpm --filter @bib/tokens build
 *   node packages/tokens/examples/print-palette.ts
 *
 * Expected output (six lines):
 *
 *   color.brand.accent oklch(0.78 0.16 70)
 *   color.brand.primary oklch(0.62 0.19 259)
 *   size.space.1 4px
 *   size.space.2 8px
 *   size.space.4 16px
 *   size.space.8 32px
 *
 * The same values ship as CSS custom properties in build/tokens.css; this
 * example reads the typed JS module instead, through the default resolver input.
 */

import { resolver } from "../build/tokens.js"

const tokens = resolver.apply({})

for (const [name, token] of Object.entries(tokens)) {
  if (token.$type === "color" && name.startsWith("color.brand.")) {
    const [l, c, h] = token.$value.components
    console.log(`${name} ${token.$value.colorSpace}(${l} ${c} ${h})`)
  } else if (token.$type === "dimension" && name.startsWith("size.space.")) {
    console.log(`${name} ${token.$value.value}${token.$value.unit}`)
  }
}
