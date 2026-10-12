import { describe, expect, it } from "vitest"
import {
  collect,
  err,
  flatMap,
  isErr,
  isOk,
  map,
  mapErr,
  match,
  ok,
  type Result,
  tryCatch,
  tryCatchAsync,
  unwrap,
  unwrapOr,
} from "../src/result.ts"

const parse = (s: string): Result<number, string> => {
  const n = Number(s)
  return Number.isNaN(n) ? err(`not a number: ${s}`) : ok(n)
}

describe("ok / err / guards", () => {
  it("builds tagged values", () => {
    expect(ok(1)).toEqual({ ok: true, value: 1 })
    expect(err("x")).toEqual({ ok: false, error: "x" })
  })
  it("narrows with isOk / isErr", () => {
    const r = parse("4")
    expect(isOk(r)).toBe(true)
    expect(isErr(r)).toBe(false)
    if (isOk(r)) expect(r.value).toBe(4)
    expect(isErr(parse("x"))).toBe(true)
  })
  it("allows undefined as a success value", () => {
    const r = ok(undefined)
    expect(isOk(r)).toBe(true)
    expect(unwrap(r)).toBeUndefined()
  })
})

describe("combinators", () => {
  it("map transforms only success", () => {
    expect(map(ok(2), (n) => n * 3)).toEqual(ok(6))
    const failed = err("e") as Result<number, string> // widen: assignment would narrow
    expect(map(failed, (n) => n * 3)).toEqual(err("e"))
  })
  it("mapErr transforms only failure", () => {
    expect(mapErr(err("e"), (e) => e.toUpperCase())).toEqual(err("E"))
    const good = ok(1) as Result<number, string> // widen: assignment would narrow
    expect(mapErr(good, (e) => e.length)).toEqual(ok(1))
  })
  it("flatMap chains and short-circuits", () => {
    expect(flatMap(parse("10"), (n) => (n > 5 ? ok(n) : err("small")))).toEqual(ok(10))
    expect(flatMap(parse("1"), (n) => (n > 5 ? ok(n) : err("small")))).toEqual(err("small"))
    let called = false
    flatMap(parse("x"), (n) => {
      called = true
      return ok(n)
    })
    expect(called).toBe(false)
  })
  it("match picks the right arm", () => {
    const h = { ok: (n: number) => `ok ${n}`, err: (e: string) => `err ${e}` }
    expect(match(parse("3"), h)).toBe("ok 3")
    expect(match(parse("z"), h)).toBe("err not a number: z")
  })
  it("unwrapOr falls back on failure", () => {
    expect(unwrapOr(parse("7"), 0)).toBe(7)
    expect(unwrapOr(parse("q"), 0)).toBe(0)
  })
})

describe("unwrap", () => {
  it("returns the value on success", () => {
    expect(unwrap(ok("v"))).toBe("v")
  })
  it("rethrows an Error as-is", () => {
    const e = new TypeError("boom")
    expect(() => unwrap(err(e))).toThrow(e)
  })
  it("wraps a non-Error with cause", () => {
    try {
      unwrap(err({ code: 7 }))
      expect.unreachable()
    } catch (thrown) {
      expect(thrown).toBeInstanceOf(Error)
      expect(thrown instanceof Error && thrown.cause).toEqual({ code: 7 })
    }
  })
})

describe("tryCatch", () => {
  it("captures success", () => {
    expect(tryCatch(() => JSON.parse("[1]"))).toEqual(ok([1]))
  })
  it("captures a thrown Error", () => {
    const r = tryCatch(() => JSON.parse("{bad"))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBeInstanceOf(SyntaxError)
  })
  it("wraps a thrown non-Error", () => {
    const r = tryCatch(() => {
      throw "plain"
    })
    expect(!r.ok && r.error.message).toBe("plain")
    expect(!r.ok && r.error.cause).toBe("plain")
  })
  it("uses mapError when provided", () => {
    const r = tryCatch(
      () => {
        throw new Error("x")
      },
      () => "mapped" as const,
    )
    expect(r).toEqual(err("mapped"))
  })
})

describe("tryCatchAsync", () => {
  it("captures resolution and rejection", async () => {
    expect(await tryCatchAsync(async () => 5)).toEqual(ok(5))
    const r = await tryCatchAsync(async () => {
      throw new RangeError("r")
    })
    expect(!r.ok && r.error).toBeInstanceOf(RangeError)
  })
  it("applies mapError", async () => {
    const r = await tryCatchAsync(
      () => Promise.reject(new Error("net")),
      (e) => (e instanceof Error ? e.message : "?"),
    )
    expect(r).toEqual(err("net"))
  })
})

describe("collect", () => {
  it("gathers all values in order", () => {
    expect(collect([ok(1), ok(2), ok(3)])).toEqual(ok([1, 2, 3]))
  })
  it("returns the first failure", () => {
    expect(collect<number, string>([ok(1), err("a"), err("b")])).toEqual(err("a"))
  })
  it("handles empty input and generators", () => {
    expect(collect([])).toEqual(ok([]))
    function* gen(): Generator<Result<number, string>> {
      yield ok(1)
      yield ok(2)
    }
    expect(collect(gen())).toEqual(ok([1, 2]))
  })
})
