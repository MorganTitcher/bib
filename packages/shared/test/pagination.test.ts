import { describe, expect, it } from "vitest"
import { isRecord, isString } from "../src/guards.ts"
import {
  clampLimit,
  DEFAULT_PAGE_SIZE,
  decodeCursor,
  encodeCursor,
  MAX_PAGE_SIZE,
  offsetPageInfo,
  paginateArray,
} from "../src/pagination.ts"

describe("cursors", () => {
  it("round-trips JSON values as URL-safe strings", () => {
    const c = encodeCursor({ id: "inv_1", at: 1700 })
    expect(c).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(decodeCursor(c)).toEqual({ id: "inv_1", at: 1700 })
  })
  it("rejects undefined", () => {
    expect(() => encodeCursor(undefined)).toThrow(TypeError)
  })
  it("returns undefined for tampered or invalid cursors", () => {
    expect(decodeCursor("!!!")).toBeUndefined()
    expect(decodeCursor("")).toBeUndefined()
    expect(decodeCursor("bm90IGpzb24")).toBeUndefined()
  })
  it("validates the decoded shape", () => {
    const isIdCursor = (v: unknown): v is { id: string } => isRecord(v) && isString(v.id)
    expect(decodeCursor(encodeCursor({ id: "x" }), isIdCursor)).toEqual({ id: "x" })
    expect(decodeCursor(encodeCursor({ id: 1 }), isIdCursor)).toBeUndefined()
  })
})

describe("clampLimit", () => {
  it("clamps to [1, max] with a fallback", () => {
    expect(clampLimit(undefined)).toBe(DEFAULT_PAGE_SIZE)
    expect(clampLimit(Number.NaN)).toBe(DEFAULT_PAGE_SIZE)
    expect(clampLimit(0)).toBe(1)
    expect(clampLimit(-5)).toBe(1)
    expect(clampLimit(10.9)).toBe(10)
    expect(clampLimit(10_000)).toBe(MAX_PAGE_SIZE)
    expect(clampLimit(50, 25)).toBe(25)
    expect(clampLimit(undefined, 10, 30)).toBe(10)
  })
})

describe("paginateArray", () => {
  const items = Array.from({ length: 5 }, (_, i) => i)
  it("walks every page exactly once", () => {
    const seen: number[] = []
    let cursor: string | undefined
    let pages = 0
    do {
      const page = paginateArray(items, cursor === undefined ? { limit: 2 } : { limit: 2, cursor })
      seen.push(...page.items)
      cursor = page.nextCursor
      pages++
    } while (cursor !== undefined)
    expect(seen).toEqual(items)
    expect(pages).toBe(3)
  })
  it("reports hasMore", () => {
    expect(paginateArray(items, { limit: 5 }).hasMore).toBe(false)
    expect(paginateArray(items, { limit: 4 }).hasMore).toBe(true)
    expect(paginateArray([], {}).items).toEqual([])
  })
  it("rejects invalid cursors", () => {
    expect(() => paginateArray(items, { cursor: "junk" })).toThrow(RangeError)
    expect(() => paginateArray(items, { cursor: encodeCursor({ o: -1 }) })).toThrow(RangeError)
  })
})

describe("offsetPageInfo", () => {
  it("computes metadata", () => {
    expect(offsetPageInfo({ page: 3, pageSize: 10, totalItems: 45 })).toEqual({
      page: 3,
      pageSize: 10,
      offset: 20,
      totalItems: 45,
      totalPages: 5,
      hasPrevious: true,
      hasNext: true,
    })
  })
  it("handles edges", () => {
    expect(offsetPageInfo({ page: 0, pageSize: 10, totalItems: 0 })).toMatchObject({
      page: 1,
      offset: 0,
      totalPages: 0,
      hasPrevious: false,
      hasNext: false,
    })
    expect(offsetPageInfo({ page: 9, pageSize: 10, totalItems: 45 })).toMatchObject({
      offset: 80,
      hasNext: false,
    })
  })
})
