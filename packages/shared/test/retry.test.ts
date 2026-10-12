import { describe, expect, it, vi } from "vitest"
import { RateLimitError } from "../src/errors.ts"
import {
  calculateBackoffDelay,
  isRetryableError,
  NonRetryableError,
  retryWithBackoff,
} from "../src/retry.ts"

const noSleep = async (): Promise<void> => {}

describe("calculateBackoffDelay", () => {
  it("grows exponentially and caps", () => {
    expect(calculateBackoffDelay(0, 500, 30_000)).toBe(500)
    expect(calculateBackoffDelay(3, 500, 30_000)).toBe(4000)
    expect(calculateBackoffDelay(20, 500, 30_000)).toBe(30_000)
    expect(calculateBackoffDelay(2, 100, 10_000, 3)).toBe(900)
    expect(calculateBackoffDelay(-5, 500, 30_000)).toBe(500)
    expect(calculateBackoffDelay(5000, 500, 30_000)).toBe(30_000)
  })
})

describe("isRetryableError", () => {
  it("rejects NonRetryableError only", () => {
    expect(isRetryableError(new Error("x"))).toBe(true)
    expect(isRetryableError(new NonRetryableError("x"))).toBe(false)
  })
})

describe("retryWithBackoff", () => {
  it("returns on first success", async () => {
    const fn = vi.fn(async () => "ok")
    await expect(retryWithBackoff(fn, { sleep: noSleep })).resolves.toBe("ok")
    expect(fn).toHaveBeenCalledWith(1)
  })

  it("retries then succeeds, reporting delays", async () => {
    const delays: number[] = []
    const events: number[] = []
    let calls = 0
    const result = await retryWithBackoff(
      async () => {
        calls++
        if (calls < 3) throw new Error("flaky")
        return calls
      },
      {
        jitter: false,
        sleep: async (ms) => {
          delays.push(ms)
        },
        onRetry: (e) => events.push(e.attempt),
      },
    )
    expect(result).toBe(3)
    expect(delays).toEqual([500, 1000])
    expect(events).toEqual([1, 2])
  })

  it("applies full jitter via rng", async () => {
    const delays: number[] = []
    await expect(
      retryWithBackoff(
        async () => {
          throw new Error("x")
        },
        {
          maxAttempts: 2,
          rng: () => 0.5,
          sleep: async (ms) => {
            delays.push(ms)
          },
        },
      ),
    ).rejects.toThrow("x")
    expect(delays).toEqual([250])
  })

  it("rethrows the last error after maxAttempts", async () => {
    let n = 0
    await expect(
      retryWithBackoff(
        async () => {
          n++
          throw new Error(`fail ${n}`)
        },
        { maxAttempts: 3, sleep: noSleep },
      ),
    ).rejects.toThrow("fail 3")
    expect(n).toBe(3)
  })

  it("stops on NonRetryableError", async () => {
    const fn = vi.fn(async () => {
      throw new NonRetryableError("bad input")
    })
    await expect(retryWithBackoff(fn, { sleep: noSleep })).rejects.toThrow("bad input")
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it("honours shouldRetry", async () => {
    const fn = vi.fn(async () => {
      throw new Error("x")
    })
    await expect(
      retryWithBackoff(fn, { sleep: noSleep, shouldRetry: (_e, attempt) => attempt < 2 }),
    ).rejects.toThrow("x")
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it("uses a RateLimitError hint with small jitter, capped", async () => {
    const delays: number[] = []
    const sleep = async (ms: number): Promise<void> => {
      delays.push(ms)
    }
    await expect(
      retryWithBackoff(
        async () => {
          throw new RateLimitError("slow", { retryAfterMs: 2000 })
        },
        { maxAttempts: 2, rng: () => 0.5, sleep },
      ),
    ).rejects.toBeInstanceOf(RateLimitError)
    expect(delays).toEqual([2100])

    delays.length = 0
    await expect(
      retryWithBackoff(
        async () => {
          throw new RateLimitError("slow", { retryAfterMs: 999_999 })
        },
        { maxAttempts: 2, maxDelayMs: 5000, rng: () => 0, sleep },
      ),
    ).rejects.toBeInstanceOf(RateLimitError)
    expect(delays).toEqual([5000])
  })

  it("aborts before the next attempt", async () => {
    const ac = new AbortController()
    const fn = vi.fn(async () => {
      ac.abort(new Error("cancelled"))
      throw new Error("x")
    })
    await expect(retryWithBackoff(fn, { signal: ac.signal, sleep: noSleep })).rejects.toThrow(
      "cancelled",
    )
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it("rejects an invalid maxAttempts", async () => {
    await expect(retryWithBackoff(async () => 1, { maxAttempts: 0 })).rejects.toBeInstanceOf(
      RangeError,
    )
    await expect(retryWithBackoff(async () => 1, { maxAttempts: 1.5 })).rejects.toBeInstanceOf(
      RangeError,
    )
  })
})
