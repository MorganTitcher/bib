import { describe, expect, it } from "vitest"
import {
  generateToken,
  isUuid,
  parsePrefixedId,
  prefixedId,
  shortId,
  uuidv7,
  uuidv7Timestamp,
} from "../src/ids.ts"

describe("uuidv7", () => {
  it("produces valid, time-ordered UUIDs", () => {
    const a = uuidv7(1_700_000_000_000)
    const b = uuidv7(1_700_000_000_001)
    expect(isUuid(a)).toBe(true)
    expect(a[14]).toBe("7")
    expect(["8", "9", "a", "b"]).toContain(a[19])
    expect(a < b).toBe(true)
    expect(uuidv7Timestamp(a)).toBe(1_700_000_000_000)
  })
  it("is unique", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => uuidv7()))
    expect(ids.size).toBe(1000)
  })
  it("rejects out-of-range timestamps", () => {
    expect(() => uuidv7(-1)).toThrow(RangeError)
    expect(() => uuidv7(2 ** 48)).toThrow(RangeError)
  })
  it("timestamp extraction rejects non-v7", () => {
    expect(uuidv7Timestamp("not-a-uuid")).toBeUndefined()
    expect(uuidv7Timestamp(crypto.randomUUID())).toBeUndefined()
  })
})

describe("isUuid", () => {
  it("validates shape", () => {
    expect(isUuid(crypto.randomUUID())).toBe(true)
    expect(isUuid("00000000-0000-0000-0000-00000000000")).toBe(false)
    expect(isUuid("")).toBe(false)
  })
})

describe("generateToken", () => {
  it("encodes hex and base64url", () => {
    expect(generateToken()).toMatch(/^[0-9a-f]{64}$/)
    expect(generateToken(16, "base64url")).toMatch(/^[A-Za-z0-9_-]{22}$/)
  })
  it("validates length", () => {
    expect(() => generateToken(0)).toThrow(RangeError)
    expect(() => generateToken(65_537)).toThrow(RangeError)
  })
})

describe("prefixedId", () => {
  it("creates sortable typed ids", () => {
    const a = prefixedId("inv", 1_700_000_000_000)
    const b = prefixedId("inv", 1_700_000_000_500)
    expect(a).toMatch(/^inv_[0-9A-HJKMNP-TV-Z]{26}$/)
    expect(a.slice(0, 14) < b.slice(0, 14)).toBe(true)
    expect(parsePrefixedId(a)?.[0]).toBe("inv")
  })
  it("validates the prefix", () => {
    expect(() => prefixedId("Inv")).toThrow()
    expect(() => prefixedId("")).toThrow()
    expect(() => prefixedId("a_b")).toThrow()
  })
  it("parses safely", () => {
    expect(parsePrefixedId("cus_ABC")).toEqual(["cus", "ABC"])
    expect(parsePrefixedId("noprefix")).toBeUndefined()
    expect(parsePrefixedId("_x")).toBeUndefined()
    expect(parsePrefixedId("x_")).toBeUndefined()
  })
})

describe("shortId", () => {
  it("uses the alphabet and length", () => {
    expect(shortId()).toHaveLength(8)
    expect(shortId(20, "ab")).toMatch(/^[ab]{20}$/)
  })
  it("validates arguments", () => {
    expect(() => shortId(0)).toThrow(RangeError)
    expect(() => shortId(5, "a")).toThrow(RangeError)
  })
})
