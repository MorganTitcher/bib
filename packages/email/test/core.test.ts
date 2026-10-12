import { describe, expect, it } from "vitest"
import {
  classifyHttpStatus,
  EMAIL_ERROR_KINDS,
  EmailError,
  isAmbiguousKind,
  isEmailError,
  isRetryableKind,
} from "../src/errors.ts"
import { checkCapabilities, effectiveIdempotencyKey, sendResult } from "../src/provider.ts"
import { CONSOLE_CAPABILITIES } from "../src/providers/console.ts"
import { contractMessage } from "../src/testing.ts"

describe("errors", () => {
  it.each([
    [401, "authentication"],
    [403, "authentication"],
    [408, "timeout"],
    [409, "idempotency_conflict"],
    [429, "rate_limited"],
    [500, "unavailable"],
    [599, "unavailable"],
    [400, "rejected"],
    [422, "rejected"],
    [302, "unknown"],
    [200, "unknown"],
  ])("classifies %i as %s", (status, kind) => {
    expect(classifyHttpStatus(status)).toBe(kind)
  })

  it("marks retryable and ambiguous kinds", () => {
    const retryable = EMAIL_ERROR_KINDS.filter(isRetryableKind)
    expect(new Set(retryable)).toEqual(
      new Set(["rate_limited", "unavailable", "network", "timeout", "in_progress"]),
    )
    expect(EMAIL_ERROR_KINDS.filter(isAmbiguousKind)).toEqual(
      expect.arrayContaining(["network", "timeout"]),
    )
    expect(EMAIL_ERROR_KINDS.filter(isAmbiguousKind)).toHaveLength(2)
  })

  it("builds an error with getters and details", () => {
    const e = new EmailError("rate_limited", "slow down", {
      provider: "p",
      httpStatus: 429,
      providerCode: "rate_limit",
      retryAfterMs: 1500,
    })
    expect(e.code).toBe("email_rate_limited")
    expect(e.status).toBe(429)
    expect(e.retryable).toBe(true)
    expect(e.ambiguous).toBe(false)
    expect(e.retryAfterMs).toBe(1500)
    expect(e.details).toMatchObject({ kind: "rate_limited", provider: "p", httpStatus: 429 })
    expect(isEmailError(e)).toBe(true)
    expect(isEmailError(new Error("x"))).toBe(false)
  })

  it("drops invalid retry hints", () => {
    expect(new EmailError("unavailable", "x", { retryAfterMs: -1 }).retryAfterMs).toBeUndefined()
    expect(
      new EmailError("unavailable", "x", { retryAfterMs: Number.NaN }).retryAfterMs,
    ).toBeUndefined()
  })
})

describe("provider helpers", () => {
  it("prefers the option key over the message key", () => {
    const message = contractMessage({ idempotencyKey: "from-message" })
    expect(effectiveIdempotencyKey(message, undefined)).toBe("from-message")
    expect(effectiveIdempotencyKey(message, { idempotencyKey: "from-option" })).toBe("from-option")
  })

  it("stamps a send result", () => {
    expect(sendResult("p", "id-1", new Date("2026-10-11T00:00:00Z"))).toEqual({
      provider: "p",
      messageId: "id-1",
      acceptedAt: "2026-10-11T00:00:00.000Z",
    })
  })

  it("checks recipients, attachment support and size", () => {
    const caps = { ...CONSOLE_CAPABILITIES, maxRecipients: 2, maxAttachmentBytes: 10 }
    expect(checkCapabilities("p", caps, contractMessage()).ok).toBe(true)

    const empty = checkCapabilities("p", caps, contractMessage({ to: [] }))
    expect(!empty.ok && empty.error.kind).toBe("validation")

    const many = checkCapabilities(
      "p",
      caps,
      contractMessage({ cc: [{ email: "c@example.com" }], bcc: [{ email: "b@example.com" }] }),
    )
    expect(!many.ok && many.error.kind).toBe("validation")

    const attachment = {
      filename: "a.txt",
      content: "QUJD",
      contentType: "text/plain",
      disposition: "attachment" as const,
      size: 11,
    }
    const big = checkCapabilities("p", caps, contractMessage({ attachments: [attachment] }))
    expect(!big.ok && big.error.kind).toBe("validation")

    const unsupported = checkCapabilities(
      "p",
      { ...caps, attachments: false },
      contractMessage({ attachments: [{ ...attachment, size: 3 }] }),
    )
    expect(!unsupported.ok && unsupported.error.kind).toBe("configuration")
  })
})
