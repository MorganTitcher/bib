# @bib/tokens

Brand design tokens in the [DTCG 2025.10](https://www.designtokens.org/tr/2025.10/format/) format,
built with [Terrazzo](https://terrazzo.app) into CSS custom properties and a typed JS module.

**Maturity: experimental.** It builds and the output is checked, but it ships one example brand
with no themes, no dark mode and no tests beyond Terrazzo's own schema check.

## Maturity

| Module | Status | Ported from | Notes |
| --- | --- | --- | --- |
| `tokens/brand.tokens.json` | experimental | new | One example brand: 21 tokens (brand and neutral colours, surface aliases, font families and weights, radius, spacing). Replace the values, keep the names. |
| `@bib/tokens/css` | experimental | new | CSS variables named `--bib-<path>` with dots as dashes. Aliases stay as `var()` references. |
| `@bib/tokens` (JS) | experimental | new | Generated `resolver` and `PERMUTATIONS` with a typed `Tokens` interface. |
| themes / dark mode | scaffold | not started | Single permutation only. Add a resolver set when a second theme or brand needs it. |

## Use it

Edit `tokens/brand.tokens.json`, then:

```sh
pnpm --filter @bib/tokens build   # writes build/tokens.css, tokens.js, tokens.d.ts
pnpm --filter @bib/tokens test    # terrazzo check: schema and alias validation
```

Colours use the DTCG object form (`{ "colorSpace": "oklch", "components": [L, C, H] }`) and
dimensions use `{ "value": 16, "unit": "px" }`. Aliases are `"{color.neutral.0}"`.

### CSS

```css
@import "@bib/tokens/css";

.button {
  background: var(--bib-color-brand-primary);  /* oklch(62% 0.19 259) */
  color: var(--bib-color-surface-background);  /* var(--bib-color-neutral-0) */
  padding: var(--bib-size-space-4);            /* 16px */
}
```

### JS

```ts
import { resolver } from "@bib/tokens"

const tokens = resolver.apply({})
tokens["color.brand.primary"].$value
// { colorSpace: "oklch", components: [0.62, 0.19, 259], alpha: 1 }
tokens["color.surface.background"].$value // aliases come back resolved
```

The raw source is exported as `@bib/tokens/source` for tools that read DTCG directly.

### Checking contrast

Tokens do not check accessibility themselves. `contrastRatio` and `meetsContrast` from
`@bib/svg/color` accept the same oklch strings the CSS uses (4.5:1 for body text, 3:1 for large
text):

```ts
import { contrastRatio } from "@bib/svg/color"
contrastRatio("oklch(20% 0.016 260)", "oklch(99% 0.003 260)") // 17.59: surface foreground on background
```

## Limits

- No `examples/` directory yet: the CSS and JS snippets above are the examples.
- One brand, one mode. Light/dark and multiple brands need a resolver with more permutations.
- The other source repos still have their own token pipelines. Nothing consumes this package yet.
