import { describe, expect, it } from "vitest"
import {
  contentHash,
  fnv1a32,
  isSha256Hex,
  type StableValue,
  sha256,
  sha256Bytes,
  stableStringify,
  timingSafeEqual,
} from "../src/hashing.ts"

describe("stableStringify", () => {
  it("sorts keys recursively", () => {
    expect(stableStringify({ b: 1, a: [2, { d: 3, c: 4 }] })).toBe('{"a":[2,{"c":4,"d":3}],"b":1}')
  })
  it("follows JSON undefined semantics", () => {
    expect(stableStringify({ a: undefined, b: 1 })).toBe('{"b":1}')
    expect(stableStringify([undefined, 1])).toBe("[null,1]")
    expect(stableStringify(undefined)).toBe("null")
    expect(stableStringify(null)).toBe("null")
    expect(stableStringify("x\n")).toBe('"x\\n"')
  })
  it("rejects non-finite numbers", () => {
    expect(() => stableStringify(Number.NaN)).toThrow(TypeError)
    expect(() => stableStringify({ a: Number.POSITIVE_INFINITY })).toThrow(TypeError)
  })
  it("rejects cycles but allows shared references", () => {
    const shared = { x: 1 }
    expect(stableStringify({ a: shared, b: shared })).toBe('{"a":{"x":1},"b":{"x":1}}')
    const cyclic: { self?: StableValue } = {}
    cyclic.self = cyclic
    expect(() => stableStringify(cyclic)).toThrow(TypeError)
  })
})

describe("sha256", () => {
  it("matches known vectors", async () => {
    expect(await sha256("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    )
    expect(await sha256("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    )
    expect(await sha256Bytes(new Uint8Array([0x61, 0x62, 0x63]))).toBe(await sha256("abc"))
  })
  it("hashes UTF-8", async () => {
    expect(await sha256("é")).not.toBe(await sha256("e"))
  })
})

describe("contentHash", () => {
  it("is order-insensitive for keys and sensitive to values", async () => {
    expect(await contentHash({ a: 1, b: 2 })).toBe(await contentHash({ b: 2, a: 1 }))
    expect(await contentHash({ a: 1 })).not.toBe(await contentHash({ a: 2 }))
    expect(isSha256Hex(await contentHash([1, 2, 3]))).toBe(true)
  })
})

describe("isSha256Hex and timingSafeEqual", () => {
  it("validates digests", () => {
    expect(isSha256Hex("a".repeat(64))).toBe(true)
    expect(isSha256Hex("A".repeat(64))).toBe(false)
    expect(isSha256Hex("a".repeat(63))).toBe(false)
  })
  it("compares strings", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true)
    expect(timingSafeEqual("abc", "abd")).toBe(false)
    expect(timingSafeEqual("abc", "ab")).toBe(false)
    expect(timingSafeEqual("", "")).toBe(true)
  })
})

describe("fnv1a32", () => {
  it("matches the published FNV-1a 32-bit vectors", () => {
    expect(fnv1a32("")).toBe(0x811c9dc5)
    expect(fnv1a32("a")).toBe(0xe40c292c)
    expect(fnv1a32("foobar")).toBe(0xbf9cf968)
  })
  it("is an unsigned 32-bit integer", () => {
    for (const text of ["x", "badge|label|msg", "😀"]) {
      const h = fnv1a32(text)
      expect(Number.isInteger(h) && h >= 0 && h < 2 ** 32).toBe(true)
    }
  })
})
