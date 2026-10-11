/**
 * A reusable contract suite for fetch-based adapters, plus a recording mock
 * `fetch`.
 *
 * `runProviderContract({ describe, it }, harness)` registers the cases every
 * HTTP adapter must pass. It imports no test framework: pass your runner's
 * `describe` and `it` (vitest, node:test, jest). Assertions throw plain
 * `Error`s.
 *
 * The harness builds the provider around the injected mock `fetch`, and says
 * what a successful response looks like and which secret must never leak.
 *
 * Cases:
 * - a minimal send succeeds and returns the provider name and message id;
 * - the request carries the recipient and the subject;
 * - a message over `maxRecipients` is rejected with **no** request;
 * - 429 + `Retry-After: 7` → `rate_limited`, `retryAfterMs` 7000;
 * - 500 / 503 → `unavailable`; 400 / 422 → `rejected`; 401 / 403 → `authentication`;
 * - a throwing `fetch` → `network`; an already-aborted signal → `aborted`, no request;
 * - when `capabilities.idempotency`, the key is sent as a header;
 * - attachment content reaches the request body;
 * - the secret never appears in an error message, even when the server or the
 *   transport echoes it;
 * - `healthCheck`, when present, returns a `Result`.
 *
 * @example
 * ```ts
 * import { describe, it } from "vitest"
 * import { runProviderContract } from "@bib/email/testing"
 *
 * runProviderContract({ describe, it }, {
 *   name: "resend",
 *   secret: "re_test_secret",
 *   makeProvider: (fetch) => createResendProvider({ apiKey: "re_test_secret", fetch }),
 *   success: () => ({ status: 200, body: { id: "msg_1" } }),
 * })
 * ```
 */

import type { EmailError } from "./errors.ts"
import type { EmailMessage } from "./message.ts"
import type { EmailProvider, FetchLike, SendOutcome } from "./provider.ts"

/** One request seen by {@link createMockFetch}. */
export interface RecordedRequest {
  readonly url: string
  readonly method: string
  /** Lower-cased header names. */
  readonly headers: Readonly<Record<string, string>>
  readonly body: string
}

/** A canned response. */
export interface MockResponse {
  readonly status: number
  /** Serialized as JSON unless it is already a string. */
  readonly body?: unknown
  readonly headers?: Readonly<Record<string, string>>
}

/** What a responder may do: answer, or throw to simulate a transport failure. */
export type Responder = (request: RecordedRequest) => MockResponse | Promise<MockResponse>

/** A recording mock `fetch`. */
export interface MockFetch {
  readonly fetch: FetchLike
  readonly requests: readonly RecordedRequest[]
  /** Replace the responder. */
  respond(responder: Responder): void
}

function headersToRecord(headers: RequestInit["headers"]): Record<string, string> {
  const out: Record<string, string> = {}
  if (headers === undefined) return out
  new Headers(headers).forEach((value, key) => {
    out[key] = value
  })
  return out
}

/** Create a {@link MockFetch}. The default responder answers `200 {}`. */
export function createMockFetch(initial: Responder = () => ({ status: 200, body: {} })): MockFetch {
  const requests: RecordedRequest[] = []
  let responder = initial
  const fetchImpl: FetchLike = async (input, init) => {
    const request: RecordedRequest = {
      url: input,
      method: (init.method ?? "GET").toUpperCase(),
      headers: headersToRecord(init.headers),
      body: typeof init.body === "string" ? init.body : "",
    }
    requests.push(request)
    const answer = await responder(request)
    const text =
      answer.body === undefined
        ? ""
        : typeof answer.body === "string"
          ? answer.body
          : JSON.stringify(answer.body)
    return new Response(text === "" ? null : text, {
      status: answer.status,
      headers: { "content-type": "application/json", ...answer.headers },
    })
  }
  return {
    fetch: fetchImpl,
    get requests() {
      return requests
    },
    respond(next) {
      responder = next
    },
  }
}

/** Describes the adapter under test. */
export interface ContractHarness {
  /** Used in test titles. */
  readonly name: string
  /** Build the provider around the mock transport. */
  makeProvider(fetch: FetchLike): EmailProvider
  /** The provider's success response for a send. */
  success(): MockResponse
  /** A credential the adapter holds. It must never appear in an error message. */
  readonly secret: string
  /** Whether a send returns a non-empty message id. Default true. */
  readonly returnsMessageId?: boolean
}

/** The subset of a test runner the suite needs. */
export interface ContractRunner {
  describe(name: string, fn: () => void): void
  it(name: string, fn: () => Promise<void> | void): void
}

/** A minimal valid message, built without `parseMessage` so tests can exceed limits. */
export function contractMessage(overrides: Partial<EmailMessage> = {}): EmailMessage {
  return {
    from: { email: "sender@example.com", name: "Sender" },
    to: [{ email: "recipient@example.com" }],
    cc: [],
    bcc: [],
    replyTo: [],
    subject: "Contract subject line",
    text: "Contract body",
    attachments: [],
    tags: [],
    headers: {},
    metadata: {},
    ...overrides,
  }
}

function fail(message: string): never {
  throw new Error(`contract: ${message}`)
}

function expectError(outcome: SendOutcome, kind: string): EmailError {
  if (outcome.ok) fail(`expected a ${kind} error, got success`)
  if (outcome.error.kind !== kind) {
    fail(`expected kind ${kind}, got ${outcome.error.kind}: ${outcome.error.message}`)
  }
  return outcome.error
}

/** Register the contract cases for one adapter. */
export function runProviderContract(runner: ContractRunner, harness: ContractHarness): void {
  const { describe, it } = runner
  const setup = (responder?: Responder) => {
    const mock = createMockFetch(responder ?? (() => harness.success()))
    return { mock, provider: harness.makeProvider(mock.fetch) }
  }
  const errorBody =
    (status: number): Responder =>
    () => ({
      status,
      body: {
        message: `server echoed ${harness.secret}`,
        Message: `server echoed ${harness.secret}`,
      },
    })

  describe(`${harness.name} provider contract`, () => {
    it("sends a minimal message", async () => {
      const { mock, provider } = setup()
      const outcome = await provider.send(contractMessage())
      if (!outcome.ok) fail(`send failed: ${outcome.error.kind} ${outcome.error.message}`)
      if (outcome.value.provider !== provider.name) fail("result.provider is not the provider name")
      if ((harness.returnsMessageId ?? true) && outcome.value.messageId === "")
        fail("empty messageId")
      if (Number.isNaN(Date.parse(outcome.value.acceptedAt))) fail("acceptedAt is not a date")
      if (mock.requests.length !== 1) fail(`expected 1 request, saw ${mock.requests.length}`)
    })

    it("puts the recipient and subject in the request", async () => {
      const { mock, provider } = setup()
      await provider.send(contractMessage())
      const body = mock.requests[0]?.body ?? ""
      if (!body.includes("recipient@example.com")) fail("recipient missing from the request body")
      if (!body.includes("Contract subject line")) fail("subject missing from the request body")
    })

    it("rejects a message over maxRecipients without a request", async () => {
      const { mock, provider } = setup()
      const n = provider.capabilities.maxRecipients + 1
      const to = Array.from({ length: n }, (_, i) => ({ email: `r${i}@example.com` }))
      expectError(await provider.send(contractMessage({ to })), "validation")
      if (mock.requests.length !== 0) fail("a request was made for an over-capacity message")
    })

    it("maps 429 with Retry-After to rate_limited", async () => {
      const { provider } = setup(() => ({ status: 429, body: {}, headers: { "retry-after": "7" } }))
      const error = expectError(await provider.send(contractMessage()), "rate_limited")
      if (error.retryAfterMs !== 7000)
        fail(`retryAfterMs ${String(error.retryAfterMs)}, expected 7000`)
      if (!error.retryable) fail("rate_limited must be retryable")
    })

    for (const status of [500, 503]) {
      it(`maps ${status} to unavailable`, async () => {
        const { provider } = setup(errorBody(status))
        expectError(await provider.send(contractMessage()), "unavailable")
      })
    }

    for (const status of [400, 422]) {
      it(`maps ${status} to rejected`, async () => {
        const { provider } = setup(errorBody(status))
        const error = expectError(await provider.send(contractMessage()), "rejected")
        if (error.retryable) fail("rejected must not be retryable")
      })
    }

    for (const status of [401, 403]) {
      it(`maps ${status} to authentication without leaking the secret`, async () => {
        const { provider } = setup(errorBody(status))
        const error = expectError(await provider.send(contractMessage()), "authentication")
        if (error.message.includes(harness.secret)) fail("secret leaked into the error message")
        if (error.httpStatus !== status) fail(`httpStatus ${String(error.httpStatus)}`)
      })
    }

    it("maps a throwing fetch to network without leaking the secret", async () => {
      const { provider } = setup(() => {
        throw new TypeError(`fetch failed for ${harness.secret}`)
      })
      const error = expectError(await provider.send(contractMessage()), "network")
      if (error.message.includes(harness.secret)) fail("secret leaked into the network error")
      if (!error.ambiguous) fail("network must be ambiguous")
    })

    it("returns aborted for an already-aborted signal without a request", async () => {
      const { mock, provider } = setup()
      const controller = new AbortController()
      controller.abort()
      expectError(await provider.send(contractMessage(), { signal: controller.signal }), "aborted")
      if (mock.requests.length !== 0) fail("a request was made after abort")
    })

    it("forwards the idempotency key when supported", async () => {
      const { mock, provider } = setup()
      await provider.send(contractMessage(), { idempotencyKey: "contract-key-123" })
      const headers = Object.values(mock.requests[0]?.headers ?? {})
      const sent = headers.includes("contract-key-123")
      if (provider.capabilities.idempotency && !sent) fail("idempotency key header missing")
    })

    it("sends attachment content", async () => {
      const { mock, provider } = setup()
      const content = Buffer.from("contract attachment").toString("base64")
      const outcome = await provider.send(
        contractMessage({
          attachments: [
            {
              filename: "a.txt",
              content,
              contentType: "text/plain",
              disposition: "attachment",
              size: 19,
            },
          ],
        }),
      )
      if (!provider.capabilities.attachments) return
      if (!outcome.ok) fail(`attachment send failed: ${outcome.error.message}`)
      if (!(mock.requests[0]?.body ?? "").includes(content)) fail("attachment content missing")
    })

    it("health check returns a Result", async () => {
      const { provider } = setup()
      if (provider.healthCheck === undefined) return
      const result = await provider.healthCheck()
      if (typeof result.ok !== "boolean") fail("healthCheck did not return a Result")
    })
  })
}
