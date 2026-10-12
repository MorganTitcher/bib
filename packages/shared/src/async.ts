/**
 * Async control-flow primitives: cancellable sleep, deadlines, deferred
 * promises, debounce/throttle, and a FIFO mutex.
 *
 * Every primitive that waits accepts an `AbortSignal` where it makes sense and
 * always releases its timer and listener on every outcome, so nothing keeps the
 * event loop alive after you stop caring.
 *
 * @example
 * ```ts
 * import { withTimeout, createMutex } from "@bib/shared/async"
 *
 * const data = await withTimeout((signal) => fetch(url, { signal }).then((r) => r.json()), 5_000)
 *
 * const mutex = createMutex()
 * await mutex.runExclusive(async () => writeLedgerEntry()) // one at a time, in call order
 * ```
 */

/** Largest delay `setTimeout` honours (signed 32-bit ms); larger values fire immediately. */
export const MAX_TIMER_DELAY_MS = 2_147_483_647

function abortReason(signal: AbortSignal | undefined): unknown {
  return signal?.reason !== undefined
    ? signal.reason
    : new DOMException("The operation was aborted.", "AbortError")
}

/**
 * Resolve after `ms` milliseconds. Rejects with the signal's reason if aborted;
 * a pre-aborted signal rejects immediately without allocating a timer.
 */
export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortReason(signal))
  return new Promise<void>((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(abortReason(signal))
    }
    const timer = setTimeout(
      () => {
        signal?.removeEventListener("abort", onAbort)
        resolve()
      },
      Math.max(0, Math.min(ms, MAX_TIMER_DELAY_MS)),
    )
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}

/** A deadline expired (as opposed to caller cancellation or an operation failure). */
export class TimeoutError extends Error {
  constructor(message = "Operation timed out") {
    super(message)
    this.name = "TimeoutError"
  }
}

/** Options for {@link withTimeout}. */
export interface WithTimeoutOptions {
  /** A caller signal; aborting it cancels the wait and the operation. */
  readonly signal?: AbortSignal | undefined
  /** Message for the {@link TimeoutError}. */
  readonly message?: string | undefined
}

/**
 * Run `fn` under a deadline. `fn` receives an `AbortSignal` that fires on
 * timeout or caller abort — forward it to `fetch` or any cancellable API.
 * The first outcome wins; late results are ignored. Cancellation of the work
 * itself is cooperative: the wait settles even if `fn` ignores its signal.
 *
 * @throws RangeError when `timeoutMs` is not an integer in `[0, MAX_TIMER_DELAY_MS]`.
 */
export function withTimeout<T>(
  fn: (signal: AbortSignal) => PromiseLike<T>,
  timeoutMs: number,
  options: WithTimeoutOptions = {},
): Promise<T> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > MAX_TIMER_DELAY_MS) {
    return Promise.reject(
      new RangeError(`timeoutMs must be an integer from 0 to ${MAX_TIMER_DELAY_MS}`),
    )
  }
  const parent = options.signal
  if (parent?.aborted) return Promise.reject(abortReason(parent))

  const controller = new AbortController()
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const cleanup = (): void => {
      clearTimeout(timer)
      parent?.removeEventListener("abort", onAbort)
    }
    const fail = (error: unknown, abortWork: boolean): void => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
      if (abortWork) controller.abort(error)
    }
    const onAbort = (): void => fail(abortReason(parent), true)
    const timer = setTimeout(() => fail(new TimeoutError(options.message), true), timeoutMs)
    parent?.addEventListener("abort", onAbort, { once: true })
    try {
      void Promise.resolve(fn(controller.signal)).then(
        (value) => {
          if (settled) return
          settled = true
          cleanup()
          resolve(value)
        },
        (error: unknown) => fail(error, false),
      )
    } catch (error) {
      fail(error, false)
    }
  })
}

/** A promise with its `resolve`/`reject` exposed. */
export interface Deferred<T> {
  readonly promise: Promise<T>
  readonly resolve: (value: T | PromiseLike<T>) => void
  readonly reject: (reason?: unknown) => void
  /** True once `resolve` or `reject` has been called. */
  readonly settled: boolean
}

/** Create a {@link Deferred}. Only the first resolve/reject takes effect. */
export function deferred<T>(): Deferred<T> {
  let resolveFn: (value: T | PromiseLike<T>) => void = () => {}
  let rejectFn: (reason?: unknown) => void = () => {}
  let settled = false
  const promise = new Promise<T>((resolve, reject) => {
    resolveFn = resolve
    rejectFn = reject
  })
  return {
    promise,
    resolve: (value) => {
      if (settled) return
      settled = true
      resolveFn(value)
    },
    reject: (reason) => {
      if (settled) return
      settled = true
      rejectFn(reason)
    },
    get settled() {
      return settled
    },
  }
}

/** A debounced function with control methods. */
export interface Debounced<A extends unknown[]> {
  (...args: A): void
  /** Drop any pending call. */
  cancel(): void
  /** Run the pending call now, if any. */
  flush(): void
  /** Whether a trailing call is scheduled. */
  pending(): boolean
}

/**
 * Delay calls until `waitMs` has passed without another call; only the LAST
 * arguments are used. With `leading: true` the first call in a burst fires
 * immediately and the trailing edge fires only if more calls arrived.
 */
export function debounce<A extends unknown[]>(
  fn: (...args: A) => unknown,
  waitMs: number,
  options: { readonly leading?: boolean } = {},
): Debounced<A> {
  let timer: ReturnType<typeof setTimeout> | undefined
  let pendingArgs: A | undefined

  const fire = (): void => {
    const args = pendingArgs
    pendingArgs = undefined
    if (args) fn(...args)
  }

  const debounced = (...args: A): void => {
    const burstStarting = timer === undefined
    if (timer !== undefined) clearTimeout(timer)
    if (options.leading && burstStarting) {
      fn(...args)
    } else {
      pendingArgs = args
    }
    timer = setTimeout(() => {
      timer = undefined
      fire()
    }, waitMs)
  }
  debounced.cancel = (): void => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
    pendingArgs = undefined
  }
  debounced.flush = (): void => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
    fire()
  }
  debounced.pending = (): boolean => pendingArgs !== undefined
  return debounced
}

/** A throttled function with a cancel method. */
export interface Throttled<A extends unknown[]> {
  (...args: A): void
  /** Drop any scheduled trailing call. */
  cancel(): void
}

/**
 * Run at most once per `intervalMs`. The first call runs immediately; calls
 * inside the window collapse into one trailing call with the latest arguments.
 * `now` is injectable for tests.
 */
export function throttle<A extends unknown[]>(
  fn: (...args: A) => unknown,
  intervalMs: number,
  now: () => number = Date.now,
): Throttled<A> {
  let last = Number.NEGATIVE_INFINITY
  let timer: ReturnType<typeof setTimeout> | undefined
  let trailingArgs: A | undefined

  const throttled = (...args: A): void => {
    const elapsed = now() - last
    if (elapsed >= intervalMs && timer === undefined) {
      last = now()
      fn(...args)
      return
    }
    trailingArgs = args
    if (timer === undefined) {
      timer = setTimeout(
        () => {
          timer = undefined
          last = now()
          const pendingArgs = trailingArgs
          trailingArgs = undefined
          if (pendingArgs) fn(...pendingArgs)
        },
        Math.max(0, intervalMs - elapsed),
      )
    }
  }
  throttled.cancel = (): void => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
    trailingArgs = undefined
  }
  return throttled
}

/** A FIFO async mutex. */
export interface Mutex {
  /** True while some holder has the lock. */
  readonly locked: boolean
  /** Number of callers waiting (not counting the current holder). */
  readonly waiting: number
  /** Wait for the lock; call the returned function exactly once to release it. */
  acquire(): Promise<() => void>
  /** Run `task` while holding the lock; releases on success or failure. */
  runExclusive<T>(task: () => T | PromiseLike<T>): Promise<T>
}

/**
 * Create a FIFO mutex: holders acquire in call order. A task that throws
 * releases the lock and rejects only its own caller. Releasing twice is a
 * no-op, so a stray double release cannot hand the lock to two holders.
 */
export function createMutex(): Mutex {
  const queue: Array<() => void> = []
  let locked = false

  const makeRelease = (): (() => void) => {
    let released = false
    return () => {
      if (released) return
      released = true
      const next = queue.shift()
      if (next) next()
      else locked = false
    }
  }

  const acquire = (): Promise<() => void> => {
    if (!locked) {
      locked = true
      return Promise.resolve(makeRelease())
    }
    return new Promise((resolve) => {
      queue.push(() => resolve(makeRelease()))
    })
  }

  return {
    get locked() {
      return locked
    },
    get waiting() {
      return queue.length
    },
    acquire,
    async runExclusive<T>(task: () => T | PromiseLike<T>): Promise<T> {
      const release = await acquire()
      try {
        return await task()
      } finally {
        release()
      }
    },
  }
}
