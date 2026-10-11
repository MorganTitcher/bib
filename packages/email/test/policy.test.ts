import { describe, expect, it, vi } from "vitest"
import { createEmailClient } from "../src/client.ts"
import { EmailError } from "../src/errors.ts"
import {
  createFallbackProvider,
  defaultShouldFallback,
  intersectCapabilities,
} from "../src/fallback.ts"
import { countsAgainstHealth, withHealth } from "../src/health.ts"
import {
  createMemoryIdempotencyStore,
  type IdempotencyStore,
  idempotencyKeyFor,
  messageFingerprint,
  withIdempotency,
} from "../src/idempotency.ts"
import type { EmailProvider } from "../src/provider.ts"
import { createMemoryProvider } from "../src/providers/memory.ts"
import { isRetryableFor, withRetry } from "../src/retry.ts"
import { contractMessage } from "../src/testing.ts"

const fail = (
  kind: ConstructorParameters<typeof EmailError>[0],
  extra: { retryAfterMs?: number } = {},
) => new EmailError(kind, `${kind} failure`, { provider: "memory", ...extra })

const noSleep = { sleep: async () => {}, jitter: false } as const

describe("withRetry", () => {
  it("retries 429 and 5xx, then succeeds", async () => {
    const memory = createMemoryProvider()
    memory.failNext(fail("rate_limited"))
    memory.failNext(fail("unavailable"))
    const onRetry = vi.fn()
    const outcome = await withRetry(memory, { ...noSleep, onRetry }).send(contractMessage())
    expect(outcome.ok).toBe(true)
    expect(memory.calls).toBe(3)
    expect(onRetry).toHaveBeenCalledTimes(2)
    expect(onRetry.mock.calls[0]?.[0]).toMatchObject({ attempt: 1, provider: "memory" })
  })

  it("gives up after maxAttempts with the last error", async () => {
    const memory = createMemoryProvider()
    memory.failNext(fail("unavailable"), 5)
    const outcome = await withRetry(memory, { ...noSleep, maxAttempts: 2 }).send(contractMessage())
    expect(!outcome.ok && outcome.error.kind).toBe("unavailable")
    expect(memory.calls).toBe(2)
  })

  it.each(["rejected", "authentication", "validation", "quota"] as const)(
    "does not retry %s",
    async (kind) => {
      const memory = createMemoryProvider()
      memory.failNext(fail(kind), 3)
      const outcome = await withRetry(memory, noSleep).send(contractMessage())
      expect(!outcome.ok && outcome.error.kind).toBe(kind)
      expect(memory.calls).toBe(1)
    },
  )

  it("reuses one idempotency key across attempts and generates one when missing", async () => {
    const memory = createMemoryProvider()
    const keys: (string | undefined)[] = []
    const provider = withRetry(memory, { ...noSleep, generateKey: () => "generated-key" })
    const spy = vi.spyOn(memory, "send")
    spy.mockImplementation(async (_message, options) => {
      keys.push(options?.idempotencyKey)
      return keys.length === 1
        ? { ok: false, error: fail("network") }
        : { ok: true, value: { provider: "memory", messageId: "m", acceptedAt: "" } }
    })
    expect((await provider.send(contractMessage())).ok).toBe(true)
    expect(keys).toEqual(["generated-key", "generated-key"])
  })

  it("retries ambiguous failures only when the provider dedupes", async () => {
    const plain = createMemoryProvider({ capabilities: { idempotency: false } })
    plain.failNext(fail("network"))
    const first = await withRetry(plain, noSleep).send(contractMessage())
    expect(!first.ok && first.error.kind).toBe("network")
    expect(plain.calls).toBe(1)

    const always = createMemoryProvider({ capabilities: { idempotency: false } })
    always.failNext(fail("timeout"))
    expect(
      (await withRetry(always, { ...noSleep, retryAmbiguous: "always" }).send(contractMessage()))
        .ok,
    ).toBe(true)

    expect(isRetryableFor(fail("network"), createMemoryProvider(), "never")).toBe(false)
    expect(isRetryableFor(fail("network"), createMemoryProvider())).toBe(true)
    expect(isRetryableFor(fail("rejected"), createMemoryProvider(), "always")).toBe(false)
  })

  it("does not retry when Retry-After exceeds maxDelayMs", async () => {
    const memory = createMemoryProvider()
    memory.failNext(fail("rate_limited", { retryAfterMs: 60_000 }))
    const outcome = await withRetry(memory, { ...noSleep, maxDelayMs: 1000 }).send(
      contractMessage(),
    )
    expect(!outcome.ok && outcome.error.retryAfterMs).toBe(60_000)
    expect(memory.calls).toBe(1)
  })

  it("waits at least Retry-After", async () => {
    const memory = createMemoryProvider()
    memory.failNext(fail("rate_limited", { retryAfterMs: 2000 }))
    const waits: number[] = []
    await withRetry(memory, {
      jitter: false,
      initialDelayMs: 10,
      sleep: async (ms) => {
        waits.push(ms)
      },
    }).send(contractMessage())
    expect(waits[0]).toBeGreaterThanOrEqual(2000)
  })

  it("returns aborted when the signal fires while waiting", async () => {
    const memory = createMemoryProvider()
    memory.failNext(fail("unavailable"), 3)
    const controller = new AbortController()
    const outcome = await withRetry(memory, {
      jitter: false,
      sleep: async () => {
        controller.abort()
        throw new Error("aborted")
      },
    }).send(contractMessage(), { signal: controller.signal })
    expect(!outcome.ok && outcome.error.kind).toBe("aborted")
  })
})

describe("createFallbackProvider", () => {
  it("falls back on provider-side failures", async () => {
    const a = createMemoryProvider({ name: "a" })
    const b = createMemoryProvider({ name: "b" })
    a.failNext(fail("unavailable"))
    const onFallback = vi.fn()
    const chain = createFallbackProvider([a, b], { onFallback })
    const outcome = await chain.send(contractMessage())
    expect(outcome.ok && outcome.value.provider).toBe("b")
    expect(onFallback).toHaveBeenCalledWith(expect.objectContaining({ from: "a", to: "b" }))
    expect(chain.name).toBe("fallback(a,b)")
  })

  it("stops on rejected so suppression is not bypassed", async () => {
    const a = createMemoryProvider({ name: "a" })
    const b = createMemoryProvider({ name: "b" })
    a.failNext(fail("rejected"))
    const outcome = await createFallbackProvider([a, b]).send(contractMessage())
    expect(!outcome.ok && outcome.error.kind).toBe("rejected")
    expect(b.calls).toBe(0)
  })

  it("stops on ambiguous failures unless allowed", async () => {
    expect(defaultShouldFallback(fail("network"))).toBe(false)
    expect(defaultShouldFallback(fail("timeout"), true)).toBe(true)
    expect(defaultShouldFallback(fail("quota"))).toBe(true)
    expect(defaultShouldFallback(fail("unknown"))).toBe(false)
  })

  it("lists every failure when all providers fail", async () => {
    const a = createMemoryProvider({ name: "a" })
    const b = createMemoryProvider({ name: "b" })
    a.failNext(fail("authentication"))
    b.failNext(fail("unavailable"))
    const outcome = await createFallbackProvider([a, b]).send(contractMessage())
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.error.kind).toBe("unavailable")
    expect(outcome.error.details).toMatchObject({
      failures: [{ kind: "authentication" }, { kind: "unavailable" }],
    })
  })

  it("intersects capabilities and rejects up front", async () => {
    const a = createMemoryProvider({
      name: "a",
      capabilities: { maxRecipients: 5, maxAttachmentBytes: 100 },
    })
    const b = createMemoryProvider({
      name: "b",
      capabilities: { maxRecipients: 1, idempotency: false },
    })
    const caps = intersectCapabilities([a.capabilities, b.capabilities])
    expect(caps).toMatchObject({ maxRecipients: 1, idempotency: false, maxAttachmentBytes: 100 })
    const to = [{ email: "x@example.com" }, { email: "y@example.com" }]
    const outcome = await createFallbackProvider([a, b]).send(contractMessage({ to }))
    expect(!outcome.ok && outcome.error.kind).toBe("validation")
    expect(a.calls).toBe(0)
  })

  it("throws for an empty chain and reports health if any member is healthy", async () => {
    expect(() => createFallbackProvider([])).toThrow(RangeError)
    const down: EmailProvider = {
      ...createMemoryProvider({ name: "down" }),
      healthCheck: async () => ({ ok: false, error: fail("unavailable") }),
    }
    expect((await createFallbackProvider([down, createMemoryProvider()]).healthCheck?.())?.ok).toBe(
      true,
    )
    expect((await createFallbackProvider([down]).healthCheck?.())?.ok).toBe(false)
  })
})

describe("withIdempotency", () => {
  it("sends once and returns the stored result for the same key", async () => {
    const memory = createMemoryProvider()
    const provider = withIdempotency(memory, { store: createMemoryIdempotencyStore() })
    const message = contractMessage()
    const first = await provider.send(message, { idempotencyKey: "k1" })
    const second = await provider.send(message, { idempotencyKey: "k1" })
    expect(first.ok && first.value.deduplicated).toBeUndefined()
    expect(second.ok && second.value).toMatchObject({ messageId: "memory-1", deduplicated: true })
    expect(memory.calls).toBe(1)
  })

  it("rejects a key reused with a different message", async () => {
    const provider = withIdempotency(createMemoryProvider(), {
      store: createMemoryIdempotencyStore(),
    })
    await provider.send(contractMessage(), { idempotencyKey: "k1" })
    const outcome = await provider.send(contractMessage({ subject: "Different" }), {
      idempotencyKey: "k1",
    })
    expect(!outcome.ok && outcome.error.kind).toBe("idempotency_conflict")
  })

  it("reports in_progress for a concurrent send", async () => {
    const store = createMemoryIdempotencyStore()
    const message = contractMessage()
    await store.begin("k1", await messageFingerprint(message), 60_000)
    const outcome = await withIdempotency(createMemoryProvider(), { store }).send(message, {
      idempotencyKey: "k1",
    })
    expect(!outcome.ok && outcome.error.kind).toBe("in_progress")
  })

  it("releases on a definite failure", async () => {
    const memory = createMemoryProvider()
    memory.failNext(fail("unavailable"))
    const store = createMemoryIdempotencyStore()
    const provider = withIdempotency(memory, { store })
    expect((await provider.send(contractMessage(), { idempotencyKey: "k1" })).ok).toBe(false)
    expect((await provider.send(contractMessage(), { idempotencyKey: "k1" })).ok).toBe(true)
  })

  it("keeps the claim on an ambiguous failure when the provider cannot dedupe", async () => {
    const memory = createMemoryProvider({ capabilities: { idempotency: false } })
    memory.failNext(fail("network"))
    const provider = withIdempotency(memory, { store: createMemoryIdempotencyStore() })
    await provider.send(contractMessage(), { idempotencyKey: "k1" })
    const retry = await provider.send(contractMessage(), { idempotencyKey: "k1" })
    expect(!retry.ok && retry.error.kind).toBe("in_progress")
    expect(memory.calls).toBe(1)
  })

  it("releases on an ambiguous failure when the provider dedupes", async () => {
    const memory = createMemoryProvider()
    memory.failNext(fail("timeout"))
    const provider = withIdempotency(memory, { store: createMemoryIdempotencyStore() })
    await provider.send(contractMessage(), { idempotencyKey: "k1" })
    expect((await provider.send(contractMessage(), { idempotencyKey: "k1" })).ok).toBe(true)
  })

  it("passes through without a key, or derives one from content", async () => {
    const memory = createMemoryProvider()
    const explicit = withIdempotency(memory, { store: createMemoryIdempotencyStore() })
    await explicit.send(contractMessage())
    await explicit.send(contractMessage())
    expect(memory.calls).toBe(2)

    const content = withIdempotency(memory, {
      store: createMemoryIdempotencyStore(),
      keyFrom: "content",
    })
    await content.send(contractMessage())
    const again = await content.send(contractMessage())
    expect(again.ok && again.value.deduplicated).toBe(true)
    expect(memory.calls).toBe(3)
    expect(memory.last()?.options?.idempotencyKey).toBe(await idempotencyKeyFor(contractMessage()))
  })

  it("fails closed on store errors unless told to send", async () => {
    const broken: IdempotencyStore = {
      begin: async () => {
        throw new Error("store down")
      },
      complete: async () => {},
      release: async () => {},
    }
    const memory = createMemoryProvider()
    const closed = await withIdempotency(memory, { store: broken }).send(contractMessage(), {
      idempotencyKey: "k",
    })
    expect(!closed.ok && closed.error.kind).toBe("unknown")
    expect(memory.calls).toBe(0)
    const open = await withIdempotency(memory, { store: broken, onStoreError: "send" }).send(
      contractMessage(),
      {
        idempotencyKey: "k",
      },
    )
    expect(open.ok).toBe(true)
  })

  it("expires entries and evicts beyond maxEntries", async () => {
    let now = 0
    const store = createMemoryIdempotencyStore({ now: () => now, maxEntries: 2 })
    await store.begin("a", "f", 100)
    now = 150
    expect(await store.begin("a", "f", 100)).toEqual({ status: "started" })
    await store.begin("b", "f", 100)
    await store.begin("c", "f", 100)
    expect(store.size).toBe(2)
    store.clear()
    expect(store.size).toBe(0)
  })

  it("fingerprints ignore the idempotency key", async () => {
    expect(await messageFingerprint(contractMessage({ idempotencyKey: "x" }))).toBe(
      await messageFingerprint(contractMessage()),
    )
    expect(await idempotencyKeyFor(contractMessage())).toMatch(/^content:[0-9a-f]{64}$/)
  })
})

describe("withHealth", () => {
  it("turns unhealthy after the threshold and recovers on success", async () => {
    const memory = createMemoryProvider()
    memory.failNext(fail("unavailable"), 2)
    const onChange = vi.fn()
    const tracked = withHealth(memory, { failureThreshold: 2, onChange })
    await tracked.send(contractMessage())
    expect(tracked.health().healthy).toBe(true)
    await tracked.send(contractMessage())
    expect(tracked.health()).toMatchObject({
      healthy: false,
      consecutiveFailures: 2,
      lastError: { kind: "unavailable" },
    })
    await tracked.send(contractMessage())
    expect(tracked.health()).toMatchObject({
      healthy: true,
      consecutiveFailures: 0,
      sends: 3,
      failures: 2,
    })
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it("ignores message-caused failures", async () => {
    expect(countsAgainstHealth(fail("rejected"))).toBe(false)
    expect(countsAgainstHealth(fail("network"))).toBe(true)
    const memory = createMemoryProvider()
    memory.failNext(fail("rejected"), 5)
    const tracked = withHealth(memory, { failureThreshold: 1 })
    for (let i = 0; i < 5; i++) await tracked.send(contractMessage())
    expect(tracked.health()).toMatchObject({ healthy: true, failures: 0, sends: 5 })
    tracked.reset()
    expect(tracked.health().sends).toBe(0)
  })

  it("observes health checks", async () => {
    const provider: EmailProvider = {
      ...createMemoryProvider(),
      healthCheck: async () => ({ ok: false, error: fail("authentication") }),
    }
    const tracked = withHealth(provider, { failureThreshold: 1 })
    await tracked.healthCheck?.()
    expect(tracked.health().healthy).toBe(false)
  })
})

describe("createEmailClient", () => {
  it("validates, applies defaultFrom and sends", async () => {
    const memory = createMemoryProvider()
    const client = createEmailClient({ provider: memory, defaultFrom: "App <app@example.com>" })
    const outcome = await client.send({ to: "ada@example.com", subject: "Hi", text: "Hello" })
    expect(outcome.ok).toBe(true)
    expect(memory.last()?.message.from).toEqual({ email: "app@example.com", name: "App" })
  })

  it("returns a validation error without calling the provider", async () => {
    const memory = createMemoryProvider()
    const outcome = await createEmailClient({ provider: memory }).send({
      to: "bad",
      subject: "",
      text: "x",
    })
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.error.kind).toBe("validation")
    expect(Array.isArray(outcome.error.details?.issues)).toBe(true)
    expect(memory.calls).toBe(0)
  })

  it("contains a provider that throws", async () => {
    const throwing: EmailProvider = {
      ...createMemoryProvider(),
      send: async () => {
        throw new Error("boom")
      },
    }
    const outcome = await createEmailClient({ provider: throwing }).send({
      from: "a@example.com",
      to: "b@example.com",
      subject: "Hi",
      text: "x",
    })
    expect(!outcome.ok && outcome.error.kind).toBe("unknown")
  })

  it("health check defaults to ok", async () => {
    const bare: EmailProvider = {
      name: "bare",
      capabilities: createMemoryProvider().capabilities,
      send: async () => ({ ok: false, error: fail("unknown") }),
    }
    expect((await createEmailClient({ provider: bare }).healthCheck()).ok).toBe(true)
  })
})
