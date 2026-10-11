<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->

# bib conventions

These apply to every package under `packages/` and every plugin under `plugins/`.

## Verify before you say done

```sh
pnpm verify   # biome check, plugin + maturity validation, typecheck, build, tests (what CI runs)
```

While iterating, `pnpm --filter @bib/<name> test` and `pnpm validate` are faster. Report what you
actually ran. A step you skipped is a gap to state, not a pass.

## Maturity is declared, not implied

- `package.json` must contain `"bib": { "maturity": "stable" | "experimental" | "scaffold" }`.
- The package `README.md` must contain a table headed exactly `| Module | Status | Ported from | Notes |`.
  Every Status cell must be one of the same three words, with no qualifiers. Put caveats such as
  "live-unverified" or "needs nodemailer" in Notes.
- `pnpm validate` (`scripts/validate-maturity.mts`) fails on a missing or invalid value.
- **stable** = ported with its tests, API settled, relied on elsewhere. **experimental** = works and
  is tested, but new or the API may change. **scaffold** = placeholder, do not depend on it.
- Do not mark something more finished than it is. An adapter tested only against fakes is not
  stable, and a stub with types but no behaviour is a scaffold.
- When a module's status changes, update its row and the root README table in the same change.

## Examples are required

Every package has an `examples/` directory with something runnable or a real input file (for
example `finance/examples/saas.json` or `email/examples/console-send.ts`). README snippets show real
output, copied from an actual run against the built package, not output written by hand.
`pnpm validate` warns when `examples/` is missing.

## Reuse `@bib/shared`; do not re-implement it

Before writing a helper (Result, retry/backoff, timeouts, money, formatting, CSV, ids, hashing,
pagination, stats, dates, env parsing, events, XML escaping), check the `@bib/shared` subpath
exports in `packages/shared/package.json`. If the helper is general and missing, add it to `shared`
with tests rather than inlining a private copy. Import narrow subpaths (`@bib/shared/money`), not
the root barrel.

## Adapters pass a contract test

Anything with interchangeable providers (email today, image and storage clients later) defines a
port and exports one reusable contract suite. Every adapter runs that same suite against a mocked
transport. `@bib/email` is the model: `runProviderContract` from `@bib/email/testing`, driven by
`test/contract.test.ts`. A new adapter is not experimental until it passes the contract. Behaviour
that was never exercised against the live service goes in the Notes cell as "live-unverified".

## Fix at the source; no shims

These are unpublished internal packages, so there are no compatibility obligations. When an API is
wrong, change it and update every consumer in the same change. Do not add re-export shims,
deprecated aliases, `v2` modules, or adapters around a bad type. Delete code that is replaced.

## Skills hold no logic

A skill under `plugins/<plugin>/skills/<skill>/SKILL.md` explains inputs and outputs and calls a
package CLI or export. Math, parsing and validation live in the package, with tests. Skill names are
lowercase-hyphenated, at most 64 characters and match their directory. Descriptions are at most 1024
characters, and `SKILL.md` stays under 500 lines. A new plugin must be listed in
`.claude-plugin/marketplace.json`.

## Wording

Ported code comes from several source repos. Keep the domain generic in bib code and docs. Do not
copy code from paid products (the adsights-web `frameworks/`). Learn from the ideas only.
