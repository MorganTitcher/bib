# @bib/shared

The building blocks every other bib package uses: typed `Result` error handling,
runtime guards, a structured error hierarchy, async control flow, retry with
backoff, exact integer money, display formatting, string and CSV utilities, ids,
content hashing, cursor pagination, seeded randomness, statistics, UTC calendar
arithmetic, typed environment access, and a typed event emitter. Each module is
small, documented in place with examples, and covered by its own test file.

## Rule: no runtime dependencies

This package has **no runtime dependencies**, and must stay that way. It relies
only on the platform: ES2024, `Intl`, `TextEncoder`, and Web Crypto
(`crypto.subtle`, `crypto.getRandomValues`), which Node 20+, browsers and edge
runtimes all provide. Everything else in the monorepo depends on this package,
so any dependency added here becomes a dependency of everything. If a helper
needs a third-party library, it belongs in a different package.

## Importing

Every module is a subpath export. Import from the narrowest one you need:

```ts
import { ok, err } from "@bib/shared/result"
import { retryWithBackoff } from "@bib/shared/retry"
```

The root `@bib/shared` barrel re-exports every public name explicitly (never
`export *`). It is convenient, but it gives a wider import graph.

## Maturity

The whole package is `experimental` (`"bib": { "maturity": "experimental" }` in
`package.json`). APIs may still change, and in-repo consumers are updated in the
same change.

| Module | Status | Ported from | Notes |
|---|---|---|---|
| `result` | experimental | Inkwell + Haven shared | `Result<T, E>` with combinators, `tryCatch`, `collect` |
| `guards` | experimental | Inkwell shared | Type guards, `assert`, `assertNever`, `Brand`, error coercion |
| `errors` | experimental | Haven shared (generalized) | `AppError` hierarchy with HTTP status codes and JSON form; `Retry-After` parsing |
| `async` | experimental | Inkwell shared | `delay`, `withTimeout`, `deferred`, `debounce`, `throttle`, FIFO mutex |
| `retry` | experimental | Inkwell shared | Exponential backoff with full jitter. Honours `RateLimitError.retryAfterMs`. Options are `maxAttempts`, not `retries` |
| `money` | experimental | new (informed by both) | `bigint` minor units. Exact allocation, basis points, six rounding modes. `fromMajor` takes strings only |
| `format` | experimental | Inkwell shared | Locale-pinned number, percent, compact, duration and bytes formatting. `formatPercent` takes a fraction |
| `strings` | experimental | Inkwell shared | Slugs, grapheme-aware truncation, case conversion, HTML escaping. `splitWords` returns lowercase words |
| `csv` | experimental | Inkwell shared (+ parser) | RFC 4180 writer with formula-injection guard, plus a parser |
| `ids` | experimental | new | UUIDv7, secure tokens, prefixed sortable ids. `prefixedId` uses a ULID-like body |
| `hashing` | experimental | Inkwell shared | `stableStringify`, SHA-256 via Web Crypto, constant-time compare |
| `pagination` | experimental | Inkwell shared | Opaque base64url cursors, limit clamping, array pagination |
| `random` | experimental | new | Seeded mulberry32 RNG with distributions, for reproducible simulation |
| `stats` | experimental | new | Descriptive stats, distribution functions, z-test and Welch t-test. Throws on empty input. `percentile` takes p from 0 to 100 |
| `dates` | experimental | Inkwell + Haven shared | UTC calendar arithmetic with billing-style month clamping; timezone wall-clock |
| `env` | experimental | Inkwell shared | Fail-fast typed env readers. Errors never echo the value |
| `events` | experimental | Inkwell shared | Synchronous typed pub/sub that isolates listener errors |

## Usage

Each example is runnable as-is in an ESM module (top-level `await` where used).

### result

```ts
import { ok, err, map, unwrapOr, tryCatch, collect, type Result } from "@bib/shared/result"

function parsePort(text: string): Result<number, string> {
  const n = Number(text)
  return Number.isInteger(n) && n > 0 && n < 65536 ? ok(n) : err(`bad port: ${text}`)
}

unwrapOr(map(parsePort("8080"), (p) => p + 1), 0) // 8081
collect([parsePort("80"), parsePort("x")])         // { ok: false, error: "bad port: x" }
tryCatch(() => JSON.parse("{"))                     // { ok: false, error: SyntaxError }
```

### guards

```ts
import { isRecord, isOneOf, assert, assertNever, errorMessage, type Brand } from "@bib/shared/guards"

type UserId = Brand<string, "UserId">
const roles = ["owner", "member"] as const

const input: unknown = { role: "owner" }
if (isRecord(input) && isOneOf(input.role, roles)) {
  input.role // "owner" | "member"
}
assert(roles.length > 0, "roles must not be empty")
errorMessage(new Error("boom")) // "boom"
```

### errors

```ts
import { NotFoundError, RateLimitError, isAppError, parseRetryAfter } from "@bib/shared/errors"

try {
  throw new NotFoundError("Invoice not found")
} catch (e) {
  if (isAppError(e)) console.log(e.status, e.code, e.toJSON()) // 404 "not_found" {...}
}
new RateLimitError("Slow down", { retryAfterMs: parseRetryAfter("30") ?? 60_000 }) // retryAfterMs: 30000
```

### async

```ts
import { delay, withTimeout, debounce, createMutex } from "@bib/shared/async"

await delay(10)
await withTimeout(fetch("https://example.com"), 5_000) // rejects with TimeoutError after 5s

const save = debounce((text: string) => console.log("save", text), 300)
save("a"); save("ab") // logs "save ab" once, 300ms later

const mutex = createMutex()
await mutex.runExclusive(async () => {/* one caller at a time */})
```

### retry

```ts
import { retryWithBackoff, NonRetryableError } from "@bib/shared/retry"

const body = await retryWithBackoff(
  async () => {
    const res = await fetch("https://example.com/api")
    if (res.status === 400) throw new NonRetryableError("bad request") // stops immediately
    if (!res.ok) throw new Error(`HTTP ${res.status}`)                  // retried
    return res.text()
  },
  { maxAttempts: 4, initialDelayMs: 200, maxDelayMs: 5_000 },
)
```

### money

```ts
import { fromMajor, add, allocate, applyBps, formatMoney, toMajorString } from "@bib/shared/money"

const price = fromMajor("19.99", "USD")              // { amount: 1999n, currency: "USD" }
const total = add(price, fromMajor("5.01", "USD"))   // 2500n
allocate(fromMajor("100.00", "USD"), [1, 1, 1]).map(toMajorString) // ["33.34", "33.33", "33.33"]
toMajorString(applyBps(total, 250))                  // "0.62"  (2.5% of 25.00 = 0.625, half-even)
formatMoney(total, { locale: "en-US" })              // "$25.00"
```

### format

```ts
import { formatNumber, formatPercent, formatCompact, formatDuration, formatBytes } from "@bib/shared/format"

formatNumber(1234567.891)     // "1,234,567.891"
formatPercent(0.4321)         // "43.2%" (takes a fraction)
formatCompact(1_250_000)      // "1.3M"
formatDuration(90_061_000)    // "1d 1h 1m 1s"
formatBytes(1536)             // "1.5 KB"
formatNumber(Number.NaN)      // "—"
```

### strings

```ts
import { slugify, truncateAtWord, kebabCase, camelCase, escapeHtml, pluralize } from "@bib/shared/strings"

slugify("Crème Brûlée & Co!")                    // "creme-brulee-co"
truncateAtWord("The quick brown fox jumps", 15)  // "The quick…"
kebabCase("parseHTTPResponse")                   // "parse-http-response"
camelCase("hello world_foo")                     // "helloWorldFoo"
escapeHtml('<a href="x">')                       // "&lt;a href=&quot;x&quot;&gt;"
pluralize("invoice", 2)                          // "invoices"
```

### csv

```ts
import { objectsToCsv, parseCsvObjects } from "@bib/shared/csv"

const csv = objectsToCsv([{ name: "Ada", note: "=SUM(A1)" }], ["name", "note"])
// "name,note\r\nAda,'=SUM(A1)"   (formula injection neutralized)
parseCsvObjects('name,city\nAda,"London, UK"') // [{ name: "Ada", city: "London, UK" }]
```

### ids

```ts
import { uuidv7, uuidv7Timestamp, prefixedId, parsePrefixedId, generateToken } from "@bib/shared/ids"

const id = uuidv7()              // time-ordered UUID, sorts by creation time
uuidv7Timestamp(id)              // ms since epoch
const inv = prefixedId("inv")    // "inv_01J…" (sortable, ULID-like body)
parsePrefixedId(inv)?.prefix     // "inv"
generateToken(32)                // 64 hex chars from crypto.getRandomValues
```

### hashing

```ts
import { sha256, contentHash, stableStringify, timingSafeEqual } from "@bib/shared/hashing"

await sha256("abc") // "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
stableStringify({ b: 1, a: 2 })                                       // '{"a":2,"b":1}'
(await contentHash({ a: 1, b: 2 })) === (await contentHash({ b: 2, a: 1 })) // true
timingSafeEqual("sig-a", "sig-a")                                     // true
```

### pagination

```ts
import { paginateArray, encodeCursor, decodeCursor, clampLimit } from "@bib/shared/pagination"

const page = paginateArray(["a", "b", "c", "d", "e"], { limit: 2 })
// { items: ["a", "b"], nextCursor: "…", hasMore: true }
paginateArray(["a", "b", "c", "d", "e"], { limit: 2, cursor: page.nextCursor }).items // ["c", "d"]
decodeCursor(encodeCursor({ id: 42 })) // { id: 42 }
clampLimit(500)                        // 100
```

### random

```ts
import { createRng } from "@bib/shared/random"

const rng = createRng("scenario-1")  // string or numeric seed; same seed ⇒ same sequence
rng.int(1, 6)                        // a dice roll, reproducible
rng.normal(100, 15)                  // a Gaussian draw
rng.shuffle(["a", "b", "c"])         // a new shuffled array
const child = rng.fork("channel-a")  // an independent, still deterministic stream
```

### stats

```ts
import { mean, median, percentile, stdev, twoProportionZTest, welchTTest } from "@bib/shared/stats"

mean([1, 2, 3, 4])          // 2.5
median([3, 1, 2])           // 2
percentile([1, 2, 3, 4], 50) // 2.5  (p from 0 to 100)
stdev([2, 4, 4, 4, 5, 5, 7, 9]) // 2  (population)
twoProportionZTest({ successes: 120, trials: 1000 }, { successes: 150, trials: 1000 }).pValue // ≈ 0.0497
welchTTest([5.1, 4.9, 5.3, 5.0], [5.6, 5.8, 5.5, 5.9]).pValue // ≈ 0.0025
```

### dates

```ts
import { parseIsoDate, addMonthsClamped, monthsBetween, formatIsoDate, zonedParts } from "@bib/shared/dates"

const jan31 = parseIsoDate("2024-01-31")
if (jan31) {
  formatIsoDate(addMonthsClamped(jan31, 1)) // "2024-02-29" (clamped, not March 2)
}
parseIsoDate("2026-02-30") // undefined (impossible date, no rollover)
zonedParts(new Date("2026-03-01T03:30:00Z"), "America/New_York").day // 28
```

### env

```ts
import { requireEnv, parseEnvInt, parseEnvBoolean, parseEnvEnum } from "@bib/shared/env"

const source = { DATABASE_URL: "postgres://localhost/app", PORT: "8080", MODE: "live" }
requireEnv("DATABASE_URL", source)                                   // "postgres://localhost/app"
parseEnvInt("PORT", { source, min: 1, max: 65535 })                  // 8080
parseEnvBoolean("VERBOSE", { source, default: false })               // false
parseEnvEnum("MODE", ["live", "test"], { source })                   // "live"
// Omit `source` to read process.env.
```

### events

```ts
import { TypedEventEmitter } from "@bib/shared/events"

type InvoiceEvents = {
  paid: { invoiceId: string; amountMinor: bigint }
  voided: { invoiceId: string }
}

const bus = new TypedEventEmitter<InvoiceEvents>()
const off = bus.on("paid", ({ invoiceId }) => console.log("paid", invoiceId))
bus.emit("paid", { invoiceId: "inv_1", amountMinor: 1999n }) // logs "paid inv_1"
off()
```

## Development

```sh
pnpm --filter @bib/shared typecheck
pnpm --filter @bib/shared build
pnpm --filter @bib/shared test
pnpm exec biome check packages/shared
```

Tests live in `test/<module>.test.ts`, one file per module.
