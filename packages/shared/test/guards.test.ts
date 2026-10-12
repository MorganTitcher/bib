import { describe, expect, it } from "vitest"
import {
  AssertionError,
  assert,
  assertNever,
  type Brand,
  errorMessage,
  isBoolean,
  isNonBlankString,
  isNonEmptyArray,
  isNonNullish,
  isNumber,
  isOneOf,
  isRecord,
  isString,
  toError,
} from "../src/guards.ts"

describe("primitive guards", () => {
  it("isRecord accepts plain objects only", () => {
    expect(isRecord({})).toBe(true)
    expect(isRecord(Object.create(null))).toBe(true)
    expect(isRecord([])).toBe(false)
    expect(isRecord(null)).toBe(false)
    expect(isRecord("x")).toBe(false)
  })
  it("isString / isNonBlankString", () => {
    expect(isString("")).toBe(true)
    expect(isString(1)).toBe(false)
    expect(isNonBlankString("  a ")).toBe(true)
    expect(isNonBlankString(" \t\n")).toBe(false)
    expect(isNonBlankString(undefined)).toBe(false)
  })
  it("isNumber rejects NaN and infinities", () => {
    expect(isNumber(0)).toBe(true)
    expect(isNumber(-1.5)).toBe(true)
    expect(isNumber(Number.NaN)).toBe(false)
    expect(isNumber(Number.POSITIVE_INFINITY)).toBe(false)
    expect(isNumber("1")).toBe(false)
  })
  it("isBoolean", () => {
    expect(isBoolean(false)).toBe(true)
    expect(isBoolean(0)).toBe(false)
  })
  it("isNonEmptyArray narrows to a tuple", () => {
    const xs: readonly number[] = [4, 5]
    expect(isNonEmptyArray(xs)).toBe(true)
    if (isNonEmptyArray(xs)) {
      const head: number = xs[0]
      expect(head).toBe(4)
    }
    expect(isNonEmptyArray([])).toBe(false)
  })
  it("isNonNullish keeps falsy non-null values", () => {
    expect([0, "", false, null, undefined, Number.NaN].filter(isNonNullish)).toEqual([
      0,
      "",
      false,
      Number.NaN,
    ])
  })
  it("isOneOf narrows to the literal union", () => {
    const roles = ["admin", "member"] as const
    const v: unknown = "admin"
    expect(isOneOf(roles, v)).toBe(true)
    expect(isOneOf(roles, "guest")).toBe(false)
    expect(isOneOf(roles, 1)).toBe(false)
  })
})

describe("assert", () => {
  it("passes truthy and throws AssertionError on falsy", () => {
    expect(() => assert(1)).not.toThrow()
    expect(() => assert(0)).toThrow(AssertionError)
    expect(() => assert("", "custom")).toThrow("custom")
  })
  it("narrows types", () => {
    const v: string | undefined = "x"
    assert(v !== undefined)
    expect(v.length).toBe(1)
  })
})

describe("assertNever", () => {
  type Shape = { kind: "circle" } | { kind: "square" }
  const area = (s: Shape): string => {
    switch (s.kind) {
      case "circle":
        return "c"
      case "square":
        return "s"
      default:
        return assertNever(s)
    }
  }
  it("is unreachable for handled unions", () => {
    expect(area({ kind: "circle" })).toBe("c")
  })
  it("throws with a description when reached at runtime", () => {
    const bogus: unknown = { kind: "triangle" }
    expect(() => assertNever(bogus as never)).toThrow('Unexpected value: {"kind":"triangle"}')
    expect(() => assertNever("x" as never, "custom")).toThrow("custom")
  })
  it("survives unserializable values", () => {
    const cyclic: { self?: unknown } = {}
    cyclic.self = cyclic
    expect(() => assertNever(cyclic as never)).toThrow(AssertionError)
  })
})

describe("toError / errorMessage", () => {
  it("returns Errors unchanged", () => {
    const e = new Error("x")
    expect(toError(e)).toBe(e)
  })
  it("wraps strings and other values", () => {
    expect(toError("plain").message).toBe("plain")
    const wrapped = toError({ a: 1 })
    expect(wrapped.message).toBe('{"a":1}')
    expect(wrapped.cause).toEqual({ a: 1 })
    expect(errorMessage(42)).toBe("42")
    expect(errorMessage(new TypeError("t"))).toBe("t")
  })
})

describe("Brand", () => {
  it("is a compile-time-only tag", () => {
    type UserId = Brand<string, "UserId">
    const toUserId = (s: string): UserId => s as UserId
    const id = toUserId("u_1")
    expect(id).toBe("u_1")
  })
})
