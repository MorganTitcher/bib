/**
 * A discriminated-union `Result<T, E>` for operations that fail in expected,
 * recoverable ways (validation, parsing, a missing record). Throw for bugs;
 * return a `Result` for outcomes the caller is expected to handle.
 *
 * @example
 * ```ts
 * import { ok, err, map, match, type Result } from "@bib/shared/result"
 *
 * function parsePort(raw: string): Result<number, string> {
 *   const n = Number(raw)
 *   return Number.isInteger(n) && n > 0 && n < 65536 ? ok(n) : err(`invalid port: ${raw}`)
 * }
 *
 * match(map(parsePort("8080"), (p) => p + 1), {
 *   ok: (p) => `listening on ${p}`,
 *   err: (e) => `config error: ${e}`,
 * }) // "listening on 8081"
 * ```
 */

/** The success arm. */
export interface Ok<T> {
  readonly ok: true
  readonly value: T
}

/** The failure arm. */
export interface Err<E> {
  readonly ok: false
  readonly error: E
}

/** Either a success carrying `T` or a failure carrying `E`. */
export type Result<T, E = Error> = Ok<T> | Err<E>

/** Construct a success. */
export function ok<T>(value: T): Ok<T> {
  return { ok: true, value }
}

/** Construct a failure. */
export function err<E>(error: E): Err<E> {
  return { ok: false, error }
}

/** Narrow to the success arm. */
export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
  return result.ok
}

/** Narrow to the failure arm. */
export function isErr<T, E>(result: Result<T, E>): result is Err<E> {
  return !result.ok
}

/** Transform the success value; failures pass through untouched. */
export function map<T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  return result.ok ? ok(fn(result.value)) : result
}

/** Transform the failure value; successes pass through untouched. */
export function mapErr<T, E, F>(result: Result<T, E>, fn: (error: E) => F): Result<T, F> {
  return result.ok ? result : err(fn(result.error))
}

/** Chain a further fallible step onto a success. */
export function flatMap<T, U, E, F>(
  result: Result<T, E>,
  fn: (value: T) => Result<U, F>,
): Result<U, E | F> {
  return result.ok ? fn(result.value) : result
}

/** Exhaustively handle both arms and produce one value. */
export function match<T, E, R>(
  result: Result<T, E>,
  handlers: { readonly ok: (value: T) => R; readonly err: (error: E) => R },
): R {
  return result.ok ? handlers.ok(result.value) : handlers.err(result.error)
}

/** The success value, or `fallback` on failure. */
export function unwrapOr<T, E>(result: Result<T, E>, fallback: T): T {
  return result.ok ? result.value : fallback
}

/**
 * The success value, or throw. On failure, throws the error itself when it is
 * an `Error`, otherwise an `Error` wrapping it as `cause`.
 */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (result.ok) return result.value
  if (result.error instanceof Error) throw result.error
  throw new Error("Called unwrap on an Err result", { cause: result.error })
}

function toErrorValue(thrown: unknown): Error {
  return thrown instanceof Error ? thrown : new Error(String(thrown), { cause: thrown })
}

/**
 * Run a synchronous function and capture a throw as `Err`.
 *
 * @example
 * ```ts
 * tryCatch(() => JSON.parse("{bad")) // { ok: false, error: SyntaxError }
 * ```
 */
export function tryCatch<T>(fn: () => T): Result<T, Error>
export function tryCatch<T, E>(fn: () => T, mapError: (thrown: unknown) => E): Result<T, E>
export function tryCatch<T, E>(
  fn: () => T,
  mapError?: (thrown: unknown) => E,
): Result<T, E | Error> {
  try {
    return ok(fn())
  } catch (thrown) {
    return err(mapError ? mapError(thrown) : toErrorValue(thrown))
  }
}

/** Await an async function and capture a rejection as `Err`. */
export async function tryCatchAsync<T>(fn: () => PromiseLike<T>): Promise<Result<T, Error>>
export async function tryCatchAsync<T, E>(
  fn: () => PromiseLike<T>,
  mapError: (thrown: unknown) => E,
): Promise<Result<T, E>>
export async function tryCatchAsync<T, E>(
  fn: () => PromiseLike<T>,
  mapError?: (thrown: unknown) => E,
): Promise<Result<T, E | Error>> {
  try {
    return ok(await fn())
  } catch (thrown) {
    return err(mapError ? mapError(thrown) : toErrorValue(thrown))
  }
}

/**
 * Combine many results: all values in order if every one succeeded, otherwise
 * the FIRST failure (short-circuit, so the order of the input is meaningful).
 *
 * @example
 * ```ts
 * collect([ok(1), ok(2)])          // ok([1, 2])
 * collect([ok(1), err("a"), err("b")]) // err("a")
 * ```
 */
export function collect<T, E>(results: Iterable<Result<T, E>>): Result<T[], E> {
  const values: T[] = []
  for (const result of results) {
    if (!result.ok) return result
    values.push(result.value)
  }
  return ok(values)
}
