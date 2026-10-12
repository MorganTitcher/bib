import { describe, expect, it } from "vitest"
import { createRng, mulberry32, seedFromString } from "../src/random.ts"
import { mean, stdev } from "../src/stats.ts"

describe("seeding", () => {
  it("is deterministic", () => {
    expect(seedFromString("forecast")).toBe(seedFromString("forecast"))
    expect(seedFromString("a")).not.toBe(seedFromString("b"))
    const a = mulberry32(42)
    const b = mulberry32(42)
    expect([a(), a(), a()]).toEqual([b(), b(), b()])
  })
  it("string and numeric seeds agree", () => {
    expect(createRng("x").next()).toBe(createRng(seedFromString("x")).next())
  })
})

describe("createRng", () => {
  it("produces values in range", () => {
    const rng = createRng(1)
    for (let i = 0; i < 1000; i++) {
      const u = rng.next()
      expect(u).toBeGreaterThanOrEqual(0)
      expect(u).toBeLessThan(1)
      const n = rng.int(1, 6)
      expect(Number.isInteger(n) && n >= 1 && n <= 6).toBe(true)
      const t = rng.triangular(0, 10, 2)
      expect(t >= 0 && t <= 10).toBe(true)
    }
  })
  it("int covers both ends", () => {
    const rng = createRng(7)
    const seen = new Set<number>()
    for (let i = 0; i < 500; i++) seen.add(rng.int(1, 3))
    expect([...seen].sort()).toEqual([1, 2, 3])
  })
  it("normal has roughly the requested moments", () => {
    const rng = createRng("normal")
    const xs = Array.from({ length: 20_000 }, () => rng.normal(10, 2))
    expect(mean(xs)).toBeCloseTo(10, 1)
    expect(stdev(xs)).toBeCloseTo(2, 1)
  })
  it("lognormal is positive", () => {
    const rng = createRng(3)
    for (let i = 0; i < 100; i++) expect(rng.lognormal(0, 1)).toBeGreaterThan(0)
  })
  it("bool clamps p", () => {
    const rng = createRng(5)
    expect(rng.bool(2)).toBe(true)
    expect(rng.bool(-1)).toBe(false)
  })
  it("pick and shuffle", () => {
    const rng = createRng(9)
    const items = [1, 2, 3, 4, 5]
    expect(items).toContain(rng.pick(items))
    const shuffled = rng.shuffle(items)
    expect([...shuffled].sort()).toEqual(items)
    expect(items).toEqual([1, 2, 3, 4, 5])
    expect(() => rng.pick([])).toThrow()
  })
  it("fork is reproducible and independent", () => {
    const a = createRng(11).fork()
    const b = createRng(11).fork()
    expect(a.next()).toBe(b.next())
  })
  it("validates arguments", () => {
    const rng = createRng(1)
    expect(() => rng.int(5, 1)).toThrow()
    expect(() => rng.int(1.5, 3)).toThrow()
    expect(() => rng.normal(0, -1)).toThrow()
    expect(() => rng.lognormal(0, -1)).toThrow()
    expect(() => rng.triangular(0, 10, 11)).toThrow()
    expect(rng.triangular(4, 4, 4)).toBe(4)
  })
})
