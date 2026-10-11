import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  createMutex,
  debounce,
  deferred,
  delay,
  MAX_TIMER_DELAY_MS,
  TimeoutError,
  throttle,
  withTimeout,
} from "../src/async.ts"

describe("delay", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it("resolves after the given time", async () => {
    let done = false
    const p = delay(100).then(() => {
      done = true
    })
    await vi.advanceTimersByTimeAsync(99)
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await p
    expect(done).toBe(true)
  })

  it("rejects with the abort reason", async () => {
    const ac = new AbortController()
    const p = delay(1000, ac.signal)
    ac.abort(new Error("stop"))
    await expect(p).rejects.toThrow("stop")
  })

  it("rejects immediately when already aborted", async () => {
    const ac = new AbortController()
    ac.abort()
    await expect(delay(10, ac.signal)).rejects.toMatchObject({ name: "AbortError" })
  })

  it("exposes the timer cap", () => {
    expect(MAX_TIMER_DELAY_MS).toBe(2 ** 31 - 1)
  })
})

describe("withTimeout", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it("returns the result when fast enough", async () => {
    await expect(withTimeout(async () => 42, 100)).resolves.toBe(42)
  })

  it("rejects with TimeoutError and aborts the inner signal", async () => {
    let inner: AbortSignal | undefined
    const p = withTimeout((signal) => {
      inner = signal
      return new Promise<number>(() => {})
    }, 50)
    const assertion = expect(p).rejects.toBeInstanceOf(TimeoutError)
    await vi.advanceTimersByTimeAsync(50)
    await assertion
    expect(inner?.aborted).toBe(true)
  })

  it("uses a custom message", async () => {
    const p = withTimeout(() => new Promise<never>(() => {}), 10, { message: "too slow" })
    const assertion = expect(p).rejects.toThrow("too slow")
    await vi.advanceTimersByTimeAsync(10)
    await assertion
  })

  it("propagates the parent abort reason", async () => {
    const ac = new AbortController()
    const p = withTimeout(() => new Promise<never>(() => {}), 1000, { signal: ac.signal })
    ac.abort(new Error("parent"))
    await expect(p).rejects.toThrow("parent")
  })

  it("rejects immediately for a pre-aborted parent", async () => {
    const ac = new AbortController()
    ac.abort(new Error("already"))
    const fn = vi.fn(async () => 1)
    await expect(withTimeout(fn, 100, { signal: ac.signal })).rejects.toThrow("already")
    expect(fn).not.toHaveBeenCalled()
  })

  it("catches synchronous throws from fn", async () => {
    await expect(
      withTimeout(() => {
        throw new Error("sync")
      }, 100),
    ).rejects.toThrow("sync")
  })

  it("validates the timeout", async () => {
    await expect(withTimeout(async () => 1, -1)).rejects.toBeInstanceOf(RangeError)
    await expect(withTimeout(async () => 1, 1.5)).rejects.toBeInstanceOf(RangeError)
    await expect(withTimeout(async () => 1, MAX_TIMER_DELAY_MS + 1)).rejects.toBeInstanceOf(
      RangeError,
    )
  })
})

describe("deferred", () => {
  it("settles once", async () => {
    const d = deferred<number>()
    expect(d.settled).toBe(false)
    d.resolve(1)
    d.resolve(2)
    d.reject(new Error("late"))
    expect(d.settled).toBe(true)
    await expect(d.promise).resolves.toBe(1)
  })

  it("rejects", async () => {
    const d = deferred<number>()
    d.reject(new Error("no"))
    await expect(d.promise).rejects.toThrow("no")
  })
})

describe("debounce", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it("runs once with the latest args after the burst", () => {
    const fn = vi.fn()
    const d = debounce(fn, 100)
    d(1)
    d(2)
    vi.advanceTimersByTime(50)
    d(3)
    expect(d.pending()).toBe(true)
    vi.advanceTimersByTime(99)
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith(3)
    expect(d.pending()).toBe(false)
  })

  it("leading mode fires immediately and trails only if called again", () => {
    const fn = vi.fn()
    const d = debounce(fn, 100, { leading: true })
    d("a")
    expect(fn).toHaveBeenCalledWith("a")
    vi.advanceTimersByTime(100)
    expect(fn).toHaveBeenCalledTimes(1)
    d("b")
    d("c")
    expect(fn).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(100)
    expect(fn).toHaveBeenCalledTimes(3)
    expect(fn).toHaveBeenLastCalledWith("c")
  })

  it("cancel drops and flush runs the pending call", () => {
    const fn = vi.fn()
    const d = debounce(fn, 100)
    d(1)
    d.cancel()
    vi.advanceTimersByTime(200)
    expect(fn).not.toHaveBeenCalled()
    d(2)
    d.flush()
    expect(fn).toHaveBeenCalledWith(2)
    vi.advanceTimersByTime(200)
    expect(fn).toHaveBeenCalledTimes(1)
  })
})

describe("throttle", () => {
  it("runs the first call and one trailing call per window", () => {
    vi.useFakeTimers()
    try {
      const fn = vi.fn()
      const t = throttle(fn, 100)
      t(1)
      t(2)
      t(3)
      expect(fn).toHaveBeenCalledTimes(1)
      expect(fn).toHaveBeenCalledWith(1)
      vi.advanceTimersByTime(100)
      expect(fn).toHaveBeenCalledTimes(2)
      expect(fn).toHaveBeenLastCalledWith(3)
      t.cancel()
    } finally {
      vi.useRealTimers()
    }
  })

  it("cancel drops the trailing call", () => {
    vi.useFakeTimers()
    try {
      const fn = vi.fn()
      const t = throttle(fn, 100)
      t(1)
      t(2)
      t.cancel()
      vi.advanceTimersByTime(500)
      expect(fn).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe("createMutex", () => {
  it("serializes in FIFO order", async () => {
    const m = createMutex()
    const order: number[] = []
    const gate = deferred<void>()
    const a = m.runExclusive(async () => {
      await gate.promise
      order.push(1)
    })
    const b = m.runExclusive(async () => {
      order.push(2)
    })
    const c = m.runExclusive(async () => {
      order.push(3)
    })
    expect(m.locked).toBe(true)
    expect(m.waiting).toBe(2)
    gate.resolve()
    await Promise.all([a, b, c])
    expect(order).toEqual([1, 2, 3])
    expect(m.locked).toBe(false)
  })

  it("releases on throw", async () => {
    const m = createMutex()
    await expect(
      m.runExclusive(async () => {
        throw new Error("x")
      }),
    ).rejects.toThrow("x")
    await expect(m.runExclusive(async () => "ok")).resolves.toBe("ok")
  })

  it("double release is a no-op", async () => {
    const m = createMutex()
    const release = await m.acquire()
    release()
    release()
    expect(m.locked).toBe(false)
    const r2 = await m.acquire()
    expect(m.locked).toBe(true)
    r2()
  })
})
