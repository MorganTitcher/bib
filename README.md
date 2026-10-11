# bib — business in a box

Ready-made tooling for the parts of running a small business that every project rebuilds: brand
assets, marketing, and the finance math. bib is a pnpm monorepo with two layers:

- **`packages/`**: typed, tested libraries and CLIs that do the work.
- **`plugins/`**: thin Claude Code skills that call those CLIs, published as a plugin marketplace.

Skills hold no logic. They explain inputs and outputs and then run a package command, so the
behaviour is the same whether an agent or a person runs it.

## Layout

```
.claude-plugin/marketplace.json   Claude Code marketplace: lists every plugin below
plugins/
  brand/                          skill: brand-tokens (edit, build and use design tokens)
  finance/                        skill: unit-economics (CAC, LTV, payback, runway, sensitivity)
packages/
  finance/   @bib/finance         pure unit-economics functions + `bib-finance` CLI
  tokens/    @bib/tokens          DTCG 2025.10 brand tokens built to CSS variables + typed JS (Terrazzo)
scripts/validate-plugins.mts      checks the marketplace, plugin manifests and skill frontmatter
```

## Getting started

Requires Node 22 (`.nvmrc`) and pnpm 10.

```sh
pnpm install
pnpm verify     # lint, plugin validation, typecheck, build, tests (the same command CI runs)
```

### Finance

Describe the business in a JSON file (see `packages/finance/examples/saas.json`), then:

```sh
node packages/finance/dist/cli.js packages/finance/examples/saas.json
node packages/finance/dist/cli.js packages/finance/examples/saas.json --sensitivity churnRate
```

The output repeats the assumptions next to the metrics, so a number never travels without the
inputs that produced it. A metric that can't be computed (for example, payback when gross margin
per customer is zero or negative) is `null` and comes with a warning instead of `Infinity`.

### Brand tokens

Edit `packages/tokens/tokens/brand.tokens.json`, then `pnpm --filter @bib/tokens build`.

```css
@import "@bib/tokens/css";
.button { background: var(--bib-color-brand-primary); }
```

```ts
import { resolver } from "@bib/tokens"
const tokens = resolver.apply({})
tokens["color.brand.primary"].$value
```

### Using the skills in Claude Code

From a bib checkout:

```
/plugin marketplace add ./
/plugin install finance@bib
/plugin install brand@bib
```

The skills currently call CLIs built inside this repo, so they need a checkout with
`pnpm install && pnpm build` run.

## Adding to bib

- New capability: put the logic in a package with tests, then add a skill that calls it.
- New plugin: create `plugins/<name>/.claude-plugin/plugin.json` and list it in
  `.claude-plugin/marketplace.json`. `pnpm validate` fails if a plugin directory isn't listed.
- Skill names are lowercase-hyphenated, at most 64 characters, and match their directory;
  descriptions are at most 1024 characters; `SKILL.md` stays under 500 lines.

## Roadmap

- Images: SVG and Open Graph image generation from brand tokens (satori + resvg).
- Email: transactional and lifecycle templates (react-email) themed from the tokens.
- SEO: Search Console / GA4 pulls and keyword analysis.
- Finance: acquisition and channel CAC modelling, a shared cost ledger.
- A `create-bib` scaffolder so a new business starts from these defaults.
