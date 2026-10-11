# @bib/email

A transactional email layer that doesn't care which provider sends the mail. Validate a message once
against a Zod schema, then send it through an `EmailProvider`. The provider can be a fetch-only
adapter (Resend, Postmark, SendGrid, SES v2), a console or in-memory provider for development and
tests, or a composition of policy decorators: retry, fallback chain, idempotency and health tracking.
Every adapter passes one exported contract suite, `runProviderContract`.

## Design rules

- **Adapters never throw and never retry.** `send` returns `Result<SendResult, EmailError>`, and
  policy lives in decorators. A thrown error is caught and becomes `kind: "unknown"`.
- **No SDKs.** Adapters use an injectable `fetch`. SES signs requests with SigV4 via `node:crypto`.
- **Capabilities are checked before any request.** These are recipient limits, attachment size and
  support, tags, metadata and custom headers. A message an adapter can't represent faithfully is
  refused, not silently degraded.
- **Secrets never reach error text or logs.** Adapter errors run through `scrubSecrets`.
  `redactMessage` masks addresses, drops bodies and attachment content, and redacts sensitive header
  and metadata names.

## Error kinds

| Kind | Retryable | Ambiguous (may have sent) | Typical source |
|---|---|---|---|
| `rate_limited` | yes | no | HTTP 429 (honours `Retry-After`) |
| `unavailable` | yes | no | HTTP 5xx |
| `network` | yes | **yes** | `fetch` threw |
| `timeout` | yes | **yes** | request timed out, HTTP 408 |
| `in_progress` | yes | no | idempotency key claimed by a concurrent send |
| `validation` | no | no | schema or capability check failed |
| `rejected` | no | no | other 4xx |
| `authentication` | no | no | HTTP 401/403 |
| `configuration` | no | no | unsupported feature, scaffold provider |
| `quota` | no | no | provider-specific quota exhaustion |
| `idempotency_conflict` | no | no | same key, different message; HTTP 409 |
| `aborted` | no | no | caller's `AbortSignal` |
| `unknown` | no | no | anything unclassified |

`EmailError.code` is `email_<kind>`. `retryable` and `ambiguous` are getters.

## Maturity

The whole package is `experimental` (`"bib": { "maturity": "experimental" }`).

| Module | Status | Ported from | Notes |
|---|---|---|---|
| `address` | experimental | new | Parse and format `Name <a@b>`, quoted names, RFC 2047 `encodeHeaderWord`; rejects CR/LF injection |
| `message` | experimental | new | Zod schema: recipients, subject, html/text, attachments (base64 or bytes), tags, headers, metadata, idempotency key |
| `errors` | experimental | new | `EmailError` kinds, `classifyHttpStatus` |
| `provider` | experimental | new | `EmailProvider` interface, `ProviderCapabilities`, `checkCapabilities` |
| `http` | experimental | new | Fetch wrapper: timeout, abort, JSON parsing, `Retry-After`, secret scrubbing |
| `retry` | experimental | new (uses `@bib/shared/retry`) | Retries retryable kinds. Ambiguous failures are retried only when the provider dedupes. One key is reused across attempts |
| `fallback` | experimental | new | Ordered chain. Falls through on configuration, authentication, quota, rate_limited and unavailable; network and timeout only on opt-in |
| `idempotency` | experimental | new | `withIdempotency` with a pluggable `IdempotencyStore`; in-memory store with TTLs and eviction |
| `health` | experimental | new | Consecutive-failure health tracking with `onChange` |
| `redact` | experimental | new | `redactMessage`, `maskEmail`, `redactSecrets` |
| `client` | experimental | new | `createEmailClient`: validate, apply `defaultFrom`, send |
| `testing` | experimental | new | `runProviderContract`, `createMockFetch`, `contractMessage` |
| `providers/console` | experimental | new | One redacted JSON line per send |
| `providers/memory` | experimental | new | Records sends; scripted failures |
| `providers/resend` | experimental | new | `POST /emails`; `Idempotency-Key` header |
| `providers/postmark` | experimental | new | `POST /email`; no native idempotency |
| `providers/sendgrid` | experimental | new | `POST /v3/mail/send`; id from `X-Message-Id`; no native idempotency |
| `providers/ses` | experimental, live-unverified | new | SES v2 `SendEmail` (simple content, attachments). SigV4 matches the AWS reference vectors but hasn't been run against a live account |
| `providers/sigv4` | experimental | new | AWS Signature Version 4 via `node:crypto`. Root barrel only (no subpath) |
| `providers/smtp` | **scaffold** | new | Returns a `configuration` error. Needs the `nodemailer` dependency |

Every HTTP adapter passes `runProviderContract` with a mocked fetch.

## Official references (checked 2026-10-11)

- Resend: <https://resend.com/docs/api-reference/emails/send-email>,
  <https://resend.com/docs/api-reference/errors>
- Postmark: <https://postmarkapp.com/developer/api/email-api>,
  <https://postmarkapp.com/developer/api/overview>
- SendGrid: <https://www.twilio.com/docs/sendgrid/api-reference/mail-send/mail-send>
- SES v2: <https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_SendEmail.html>
- SigV4: <https://docs.aws.amazon.com/IAM/latest/UserGuide/create-signed-request.html>
- SMTP (scaffold): <https://nodemailer.com/smtp/>

## Usage

Build first (`pnpm --filter @bib/email build`). Examples import from `@bib/email` subpaths, which
resolve to `dist/`.

### Send with the console provider

`examples/console-send.ts` is runnable: `node packages/email/examples/console-send.ts`. Its expected
output is documented in the file header.

```ts
import { createEmailClient } from "@bib/email/client"
import { createConsoleProvider } from "@bib/email/providers/console"

const client = createEmailClient({
  provider: createConsoleProvider(),
  defaultFrom: "Receipts <receipts@example.com>",
})
const outcome = await client.send({
  to: "ada@example.com",
  subject: "Your receipt",
  text: "Thanks for order 1001.",
})
if (!outcome.ok) console.error(outcome.error.code, outcome.error.message)
```

### Production composition

Order matters. Retry wraps each provider so retries stay on one provider. Fallback moves across
providers. Idempotency sits outermost so a duplicate send never reaches the chain.

```ts
import { createFallbackProvider } from "@bib/email/fallback"
import { createMemoryIdempotencyStore, withIdempotency } from "@bib/email/idempotency"
import { createPostmarkProvider } from "@bib/email/providers/postmark"
import { createResendProvider } from "@bib/email/providers/resend"
import { withRetry } from "@bib/email/retry"

const resend = createResendProvider({ apiKey: process.env.RESEND_API_KEY ?? "" })
const postmark = createPostmarkProvider({ serverToken: process.env.POSTMARK_TOKEN ?? "" })

const provider = withIdempotency(
  createFallbackProvider([withRetry(resend), withRetry(postmark)]),
  { store: createMemoryIdempotencyStore() }, // use a shared store across instances in production
)
await provider.send(message, { idempotencyKey: `receipt:${orderId}` })
```

### Testing a custom adapter

```ts
import { describe } from "vitest"
import { runProviderContract } from "@bib/email/testing"

describe("my adapter", () => {
  runProviderContract({ /* factory receiving a mock fetch, plus expectations */ })
})
```

See `test/contract.test.ts` for the full option shape as used by the built-in adapters.

## Limits and not yet

- **SMTP is a scaffold.** Enabling it requires adding `nodemailer` as a dependency.
- **SES is unverified against a live account.** It covers simple content only: no templates, no
  raw MIME, no configuration-set event mapping. STS session tokens are supported via `credentials`.
- **No native idempotency on Postmark, SendGrid or SES.** An ambiguous failure (network or timeout) on
  those is not retried by default, and `withIdempotency` keeps the claim so a duplicate is refused
  rather than resent.
- **The in-memory idempotency store is per process.** Multiple instances need a shared store such as
  Redis or a database row with a unique key. The interface is three methods: `begin`, `complete`,
  `release`.
- **No batch sends, scheduling, templates, webhooks, bounce or complaint handling,** and no
  inbound mail.
- **Address validation is pragmatic, not full RFC 5322.** It has no comments, no group syntax and no
  IP-literal domains. Internationalized local parts are accepted; domains are not punycode-converted.
- **Header encoding** for non-ASCII display names is RFC 2047 base64 when `encodeNonAscii` is set.
  Adapters send display names as JSON fields and let the provider encode them.
