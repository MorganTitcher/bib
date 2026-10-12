import { describe, expect, it } from "vitest"
import {
  AppError,
  ConflictError,
  isAppError,
  NotFoundError,
  parseRetryAfter,
  RateLimitError,
  ValidationError,
} from "../src/errors.ts"

describe("AppError", () => {
  it("carries code, status, details and cause", () => {
    const cause = new Error("db down")
    const e = new AppError("upstream", "Upstream failed", 502, { cause, details: { id: 1 } })
    expect(e).toBeInstanceOf(Error)
    expect(e.name).toBe("AppError")
    expect(e.code).toBe("upstream")
    expect(e.status).toBe(502)
    expect(e.details).toEqual({ id: 1 })
    expect(e.cause).toBe(cause)
  })

  it("defaults status to 500 and details to {}", () => {
    const e = new AppError("x", "boom")
    expect(e.status).toBe(500)
    expect(e.details).toEqual({})
    expect(e.cause).toBeUndefined()
  })

  it("serializes without stack or cause", () => {
    const e = new AppError("x", "boom", 500, { cause: new Error("secret"), details: { a: 1 } })
    expect(JSON.parse(JSON.stringify(e))).toEqual({ code: "x", message: "boom", details: { a: 1 } })
  })
})

describe("subclasses", () => {
  it("ValidationError lists issues", () => {
    const e = new ValidationError("Invalid input", [{ path: "email", message: "required" }])
    expect(e.code).toBe("validation_failed")
    expect(e.status).toBe(400)
    expect(e.name).toBe("ValidationError")
    expect(e.issues).toEqual([{ path: "email", message: "required" }])
    expect(new ValidationError("bad").issues).toEqual([])
  })

  it("NotFoundError and ConflictError have defaults", () => {
    const nf = new NotFoundError()
    expect([nf.code, nf.status, nf.message, nf.name]).toEqual([
      "not_found",
      404,
      "Not found",
      "NotFoundError",
    ])
    const c = new ConflictError()
    expect([c.code, c.status, c.message, c.name]).toEqual([
      "conflict",
      409,
      "Conflict",
      "ConflictError",
    ])
  })

  it("RateLimitError keeps only a valid retry hint", () => {
    expect(new RateLimitError("slow", { retryAfterMs: 1500 }).retryAfterMs).toBe(1500)
    expect(new RateLimitError("slow", { retryAfterMs: 0 }).retryAfterMs).toBe(0)
    expect(new RateLimitError("slow", { retryAfterMs: -1 }).retryAfterMs).toBeUndefined()
    expect(new RateLimitError("slow", { retryAfterMs: Number.NaN }).retryAfterMs).toBeUndefined()
    const e = new RateLimitError()
    expect([e.code, e.status, e.message, e.retryAfterMs]).toEqual([
      "rate_limited",
      429,
      "Rate limited",
      undefined,
    ])
  })

  it("subclasses are AppErrors", () => {
    expect(isAppError(new NotFoundError())).toBe(true)
    expect(isAppError(new Error("x"))).toBe(false)
    expect(isAppError({ code: "x" })).toBe(false)
  })
})

describe("parseRetryAfter", () => {
  const now = Date.parse("2026-01-01T00:00:00Z")
  it("parses delta-seconds", () => {
    expect(parseRetryAfter("120", now)).toBe(120_000)
    expect(parseRetryAfter(" 0 ", now)).toBe(0)
  })
  it("parses HTTP dates relative to now", () => {
    expect(parseRetryAfter("Thu, 01 Jan 2026 00:00:30 GMT", now)).toBe(30_000)
  })
  it("clamps past dates to 0", () => {
    expect(parseRetryAfter("Wed, 31 Dec 2025 23:00:00 GMT", now)).toBe(0)
  })
  it("returns undefined for missing or garbage input", () => {
    expect(parseRetryAfter(undefined)).toBeUndefined()
    expect(parseRetryAfter(null)).toBeUndefined()
    expect(parseRetryAfter("   ")).toBeUndefined()
    expect(parseRetryAfter("soon", now)).toBeUndefined()
    expect(parseRetryAfter("-5", now)).toBeUndefined()
  })
})
