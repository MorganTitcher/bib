import { describe, expect, it } from "vitest"
import {
  isSensitiveName,
  maskEmail,
  REDACTED,
  redactMessage,
  redactSecrets,
} from "../src/redact.ts"
import { contractMessage } from "../src/testing.ts"

describe("maskEmail", () => {
  it("keeps the first character and the domain", () => {
    expect(maskEmail("ada@example.com")).toBe("a***@example.com")
    expect(maskEmail("élodie@example.com")).toBe("é***@example.com")
  })

  it("fully masks values without a local part", () => {
    expect(maskEmail("no-at-sign")).toBe("***")
    expect(maskEmail("@example.com")).toBe("***")
  })
})

describe("isSensitiveName", () => {
  it.each(["Authorization", "X-Api-Key", "session_id", "reset_token", "key", "password"])(
    "flags %s",
    (name) => expect(isSensitiveName(name)).toBe(true),
  )
  it.each(["X-Entity-Ref", "order_id", "keyboard"])("allows %s", (name) =>
    expect(isSensitiveName(name)).toBe(false),
  )
})

describe("redactMessage", () => {
  const message = contractMessage({
    html: "<p>account number 1234</p>",
    headers: { "X-Entity-Ref": "abc", "X-Auth-Token": "tok" },
    metadata: { order_id: "o-1", sensitive_note: "do not log", api_key: "k" },
    attachments: [
      {
        filename: "a.pdf",
        content: "QUJD",
        contentType: "application/pdf",
        disposition: "attachment",
        size: 3,
      },
    ],
    idempotencyKey: "order-1",
  })

  it("masks addresses, drops bodies and redacts sensitive fields", () => {
    const redacted = redactMessage(message, { metadataAllowlist: ["order_id", "api_key"] })
    expect(redacted.from).toBe("s***@example.com")
    expect(redacted.to).toEqual(["r***@example.com"])
    expect(redacted.subject).toBe("Contract subject line")
    expect(redacted.htmlLength).toBe(message.html?.length)
    expect(JSON.stringify(redacted)).not.toContain("account number")
    expect(JSON.stringify(redacted)).not.toContain("QUJD")
    expect(redacted.headers).toEqual({ "X-Entity-Ref": "abc", "X-Auth-Token": REDACTED })
    expect(redacted.metadata).toEqual({
      order_id: "o-1",
      sensitive_note: REDACTED,
      api_key: REDACTED,
    })
    expect(redacted.attachments).toEqual([
      { filename: "a.pdf", contentType: "application/pdf", size: 3 },
    ])
    expect(redacted.idempotencyKey).toBe("order-1")
  })

  it("can keep addresses", () => {
    expect(redactMessage(message, { maskAddresses: false }).to).toEqual(["recipient@example.com"])
  })
})

describe("redactSecrets", () => {
  it("removes listed secrets, bearer tokens and SigV4 parts", () => {
    const text =
      "key=my-secret-value Authorization: Bearer abcdefghijklmnop Credential=AKID/20261011/us-east-1/ses/aws4_request, Signature=deadbeef01"
    const out = redactSecrets(text, ["my-secret-value"])
    expect(out).not.toContain("my-secret-value")
    expect(out).not.toContain("abcdefghijklmnop")
    expect(out).not.toContain("AKID")
    expect(out).not.toContain("deadbeef01")
    expect(out).toContain(`Bearer ${REDACTED}`)
  })
})
