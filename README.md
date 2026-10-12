# bib: business in a box

Tooling for the parts of running a small business that every project ends up rebuilding: brand
assets, SEO, consent and attribution, transactional email, support SLAs and the finance model. bib
is a pnpm monorepo with two layers:

- **`packages/`**: typed, tested TypeScript libraries (and a finance CLI) that do the work.
- **`plugins/`**: thin Claude Code skills that call those packages, published as a plugin marketplace.

Skills hold no logic. They explain inputs and outputs and then run a package command, so the
behaviour is the same whether an agent or a person runs it.

Most of the code is ported from earlier projects, with their tests, onto one shared base
(`@bib/shared`). Nothing is published to npm yet, and nothing in bib has run in production under
this name. The maturity table below says how far each package has got.

## Toolchain

Node 24 (`.nvmrc`), pnpm 12, TypeScript 7, Vitest 5, Zod 4, Biome 2 and Turborepo.

```sh
pnpm install
pnpm verify   # biome, plugin + maturity validation, typecheck, build, tests (what CI runs)
```

## Packages and maturity

| Package | Maturity | Purpose | Tests |
| --- | --- | --- | --- |
| [`@bib/shared`](./packages/shared) | experimental | Dependency-free building blocks: Result, retry, async, money, formatting, CSV, ids, hashing, pagination, stats, dates, env, events | 274 |
| [`@bib/consent`](./packages/consent) | experimental | Privacy-region detection, Google Consent Mode v2 state, first-party attribution (UTMs, click IDs) | 166 |
| [`@bib/sla`](./packages/sla) | experimental | Business-hours SLA clocks with holiday calendars, pauses and warning thresholds | 105 |
| [`@bib/seo`](./packages/seo) | experimental | JSON-LD, sitemaps, robots.txt (incl. AI crawlers), llms.txt, RSS, security.txt, IndexNow | 87 |
| [`@bib/svg`](./packages/svg) | experimental | SVG escaping, builder, DSL, sanitizer, colour/contrast, badges, OG cards, BIMI checks | 195 |
| [`@bib/email`](./packages/email) | experimental | Provider-agnostic email port with retry, fallback, idempotency and an adapter contract test | 228 |
| [`@bib/finance`](./packages/finance) | experimental | Month-by-month finance model: unit economics, tornado, Monte Carlo, scenarios, variance, backsolve | 106 |
| [`@bib/tokens`](./packages/tokens) | experimental | DTCG 2025.10 brand tokens built to CSS variables and typed JS with Terrazzo | `terrazzo check` |

Test counts are from `pnpm --filter <package> test` and will move. The package README is the
authority for its own count and module list.

**What the maturity values mean.** Each package declares one in `package.json` under
`bib.maturity`, and each README has a `Module | Status | Ported from | Notes` table using the same
values per module. `pnpm validate` enforces both.

- **stable**: ported with its tests, the API is settled, and it is relied on elsewhere. Breaking
  changes need a changelog note. No package has reached this yet.
- **experimental**: works and is tested, but is new or recently reshaped and the API may change.
  Read the module notes. Some modules are tested only against fakes (for example, the SES email
  adapter has not been run against live AWS).
- **scaffold**: a placeholder or stub. It exists so the shape is visible. Do not depend on it (for
  example, the SMTP email adapter and token themes).

## Quick start

Build first (`pnpm build`). The snippets below were run against the built packages. To try one,
run `node --input-type=module -e '…'` from that package's directory, where the self-referencing
`@bib/<name>` import resolves. Each package also has an `examples/` directory with a runnable
script whose header lists its expected output.

### `@bib/shared`

```ts
import { allocate, fromMajor, toMajorString } from "@bib/shared/money"
import { collect, err, ok } from "@bib/shared/result"

allocate(fromMajor("100.00", "USD"), [1, 1, 1]).map(toMajorString) // ["33.34", "33.33", "33.33"]: no lost cent
collect([ok(80), err("bad port: x")])                              // { ok: false, error: "bad port: x" }
```

### `@bib/consent`

```ts
import { classifyRegion } from "@bib/consent"
import { parseUtm } from "@bib/consent/utm"

classifyRegion({ country: "fr" })                     // regime "gdpr", model "opt-in"
classifyRegion({ country: "CA", subdivision: "QC" })  // regime "pipeda", model "opt-in"
parseUtm(new URL("https://example.com/?utm_source=Google&utm_medium=PPC&utm_campaign=Spring"))
// { source: "google", medium: "cpc", campaign: "Spring" }
```

### `@bib/sla`

```ts
import { addBusinessTime, defineSchedule, hours, isOpen, weekdayHours } from "@bib/sla"

const desk = defineSchedule({ timeZone: "Europe/London", weekly: weekdayHours("09:00", "17:00") })
addBusinessTime(desk, new Date("2026-03-13T15:00:00Z"), hours(4)) // 2026-03-16T11:00Z (skips the weekend)
isOpen(desk, new Date("2026-03-14T12:00:00Z"))                    // false (Saturday)
```

### `@bib/seo`

```ts
import { buildRobotsTxt } from "@bib/seo"

buildRobotsTxt({
  groups: [{ userAgent: "*", disallow: ["/admin"] }],
  sitemaps: ["https://example.com/sitemap.xml"],
})
// User-agent: *
// Disallow: /admin
//
// Sitemap: https://example.com/sitemap.xml
```

### `@bib/svg`

```ts
import { contrastRatio, renderBadge, sanitizeSvg } from "@bib/svg"

contrastRatio("#ffffff", "#15803d").toFixed(2) // "5.02" (passes AA for body text)
sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect width="4" height="4" onclick="x()"/></svg>')
// { ok: true, svg: '<svg …><rect width="4" height="4"/></svg>',
//   removed: [{ kind: "element", name: "script", … }, { kind: "attribute", name: "onclick", … }] }
renderBadge({ label: "build", message: "passing", color: "green" }) // a self-contained <svg> string
```

### `@bib/email`

```ts
import { createEmailClient } from "@bib/email/client"
import { createMemoryProvider } from "@bib/email/providers/memory"

const provider = createMemoryProvider()
const email = createEmailClient({ provider, defaultFrom: "Receipts <receipts@example.com>" })
await email.send({ to: "ada@example.com", subject: "Your receipt", text: "Thanks for order 1001." }) // ok: true
await email.send({ to: "not-an-address", subject: "x", text: "x" }) // ok: false, code "email_validation"
provider.sent // what was captured, for tests
```

Swap the memory provider for a real adapter (Resend, Postmark, SES…). Every adapter passes the same
contract test, so they behave the same on retries, idempotency and errors.

### `@bib/finance`

Describe the business in a JSON model (examples in `packages/finance/examples/`), then:

```sh
node packages/finance/dist/cli.js summary packages/finance/examples/saas.json
node packages/finance/dist/cli.js economics packages/finance/examples/saas.json
node packages/finance/dist/cli.js tornado packages/finance/examples/saas.json --band --limit 3
```

```
endingCash (base 327817), band mode:
  channels.search.unitCost.cac: 563338 .. 82919 (swing 480420)
  streams.core.tiers.pro.price: 229277 .. 426356 (swing 197079)
  streams.core.retention.segments.1.monthlyChurn: 378765 .. 250343 (swing 128422)
```

Every input can be a band (`low`/`point`/`high`) with provenance. A metric that can't be computed is
`null` with a warning instead of `Infinity`. When customers outlive `meta.lifetimeCapMonths`, the
LTV is reported as a ceiling, with a warning that says how many are still active at the cap. Other
commands: `project`, `montecarlo`, `compare`, `variance`, `backsolve`, `validate` (see `--help`).

### `@bib/tokens`

Edit `packages/tokens/tokens/brand.tokens.json`, then `pnpm --filter @bib/tokens build`.

```css
@import "@bib/tokens/css";
.button { background: var(--bib-color-brand-primary); }
```

```ts
import { resolver } from "@bib/tokens"
resolver.apply({})["color.brand.primary"].$value // { colorSpace: "oklch", components: [0.62, 0.19, 259], alpha: 1 }
```

## Plugins

`.claude-plugin/marketplace.json` lists:

| Plugin | Skill | What it does |
| --- | --- | --- |
| `finance` | `unit-economics` | Builds or reads a finance model and runs the `@bib/finance` CLI (summary, economics, tornado, Monte Carlo, scenarios, variance, backsolve) |
| `brand` | `brand-tokens` | Edits and builds the DTCG tokens and checks contrast with `@bib/svg/color` |

From a bib checkout:

```
/plugin marketplace add ./
/plugin install finance@bib
/plugin install brand@bib
```

The skills call packages built inside this repo, so they need a checkout where
`pnpm install && pnpm build` has been run. The other packages do not have skills yet.

## Layout

```
.claude-plugin/marketplace.json   the plugin marketplace
plugins/<name>/                   plugin manifest + skills (no logic)
packages/<name>/                  library: src/, test/, examples/, README with maturity table
scripts/validate-plugins.mts      marketplace, manifest and skill frontmatter checks
scripts/validate-maturity.mts     bib.maturity + README maturity table checks
```

Contributor conventions (maturity, examples, reuse of `@bib/shared`, adapter contract tests) are in
[`AGENTS.md`](./AGENTS.md).

## Licensing and open questions

- **Repo license: undecided.** Packages are `UNLICENSED` and `private` until a license is chosen.
  Don't copy bib code elsewhere until this is settled.
- **npm publishing: undecided.** Nothing is published, so the packages and skills only work from a
  checkout. Publishing (private registry or public) would let the plugins work standalone.
- **Python: undecided.** Some source code worth porting (the acquisition/CAC engine and SEO data
  pulls) is Python. The open question is whether it lives here as uv packages (for example under
  `python/`) or gets ported to TypeScript on top of `@bib/finance` and `@bib/shared`.
- **Paid source frameworks are reference only.** Some source repos contain email and ads frameworks
  that are paid products. bib may learn from their ideas but does not copy their code.
- **Video: Remotion's license.** Remotion's license (checked 2026-10-12) is free for individuals,
  non-profits and for-profit organizations with up to 3 employees; larger for-profit organizations
  need a paid company license. The terms are announced to change in Remotion 5.0, so re-check them
  before adding a video package.
- **SMTP email needs nodemailer.** The SMTP adapter is a scaffold until `nodemailer` is added as a
  dependency and the adapter passes the contract test.
