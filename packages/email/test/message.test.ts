import { describe, expect, it } from "vitest"
import {
  allRecipients,
  attachmentBytes,
  base64DecodedLength,
  bytesToBase64,
  guessContentType,
  parseMessage,
} from "../src/message.ts"

const base = {
  from: "App <no-reply@example.com>",
  to: "ada@example.com",
  subject: "Welcome",
  text: "Hello",
}

function issues(input: unknown): { path: string; message: string }[] {
  const result = parseMessage(input)
  if (result.ok) throw new Error("expected a validation failure")
  return result.error.issues as { path: string; message: string }[]
}

describe("parseMessage", () => {
  it("normalizes a minimal message", () => {
    const result = parseMessage(base)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toEqual({
      from: { email: "no-reply@example.com", name: "App" },
      to: [{ email: "ada@example.com" }],
      cc: [],
      bcc: [],
      replyTo: [],
      subject: "Welcome",
      text: "Hello",
      attachments: [],
      tags: [],
      headers: {},
      metadata: {},
    })
  })

  it("requires html or text", () => {
    const { text: _text, ...noBody } = base
    expect(parseMessage(noBody).ok).toBe(false)
  })

  it("rejects an empty or multi-line subject", () => {
    expect(parseMessage({ ...base, subject: "" }).ok).toBe(false)
    expect(parseMessage({ ...base, subject: "a\r\nBcc: x@example.com" }).ok).toBe(false)
  })

  it("reports address problems with indexed paths", () => {
    const found = issues({ ...base, to: ["ok@example.com", "broken"] })
    expect(found.some((i) => i.path === "to.1")).toBe(true)
  })

  it("requires at least one recipient", () => {
    expect(issues({ ...base, to: [] })).toContainEqual({
      path: "to",
      message: "at least one recipient is required",
    })
  })

  it("rejects reserved headers", () => {
    const found = issues({ ...base, headers: { From: "evil@example.com" } })
    expect(found.some((i) => i.message.includes("cannot be overridden"))).toBe(true)
  })

  it("accepts custom headers", () => {
    const result = parseMessage({ ...base, headers: { "X-Entity-Ref": "abc" } })
    expect(result.ok && result.value.headers).toEqual({ "X-Entity-Ref": "abc" })
  })

  it("validates tag characters and counts", () => {
    expect(parseMessage({ ...base, tags: [{ name: "category", value: "welcome_1" }] }).ok).toBe(
      true,
    )
    expect(parseMessage({ ...base, tags: [{ name: "bad name", value: "x" }] }).ok).toBe(false)
    const tags = Array.from({ length: 51 }, (_, i) => ({ name: `t${i}`, value: "v" }))
    expect(parseMessage({ ...base, tags }).ok).toBe(false)
  })

  it("limits metadata entries", () => {
    const metadata = Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`k${i}`, "v"]))
    expect(parseMessage({ ...base, metadata }).ok).toBe(false)
  })

  it("validates the idempotency key", () => {
    expect(parseMessage({ ...base, idempotencyKey: "order-1" }).ok).toBe(true)
    expect(parseMessage({ ...base, idempotencyKey: "has\nnewline" }).ok).toBe(false)
    expect(parseMessage({ ...base, idempotencyKey: "x".repeat(257) }).ok).toBe(false)
  })

  describe("attachments", () => {
    it("normalizes a base64 attachment", () => {
      const content = Buffer.from("hello world").toString("base64")
      const result = parseMessage({ ...base, attachments: [{ filename: "notes.txt", content }] })
      expect(result.ok && result.value.attachments).toEqual([
        {
          filename: "notes.txt",
          content,
          contentType: "text/plain",
          disposition: "attachment",
          size: 11,
        },
      ])
    })

    it("accepts bytes and defaults to inline with a content id", () => {
      const result = parseMessage({
        ...base,
        attachments: [
          { filename: "logo.png", content: new Uint8Array([1, 2, 3]), contentId: "logo" },
        ],
      })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      const [a] = result.value.attachments
      expect(a).toMatchObject({
        content: "AQID",
        disposition: "inline",
        contentType: "image/png",
        size: 3,
      })
    })

    it("rejects invalid base64", () => {
      expect(
        issues({ ...base, attachments: [{ filename: "a.bin", content: "not base64!" }] }),
      ).toContainEqual({
        path: "attachments.0.content",
        message: "content is not valid base64",
      })
    })

    it("rejects path separators in filenames", () => {
      expect(
        parseMessage({ ...base, attachments: [{ filename: "../a.txt", content: "QQ==" }] }).ok,
      ).toBe(false)
    })
  })

  it("reports every issue at once through the shared ValidationError", () => {
    const result = parseMessage({ from: "bad", to: [], subject: "" })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.name).toBe("ValidationError")
      expect(result.error.issues.length).toBeGreaterThan(1)
    }
  })
})

describe("helpers", () => {
  it("guesses content types", () => {
    expect(guessContentType("report.PDF")).toBe("application/pdf")
    expect(guessContentType("blob")).toBe("application/octet-stream")
    expect(guessContentType("x.unknownext")).toBe("application/octet-stream")
  })

  it("computes decoded base64 length", () => {
    expect(base64DecodedLength("")).toBe(0)
    expect(base64DecodedLength("QQ==")).toBe(1)
    expect(base64DecodedLength("QUI=")).toBe(2)
    expect(base64DecodedLength("QUJD")).toBe(3)
  })

  it("encodes a subarray view of bytes", () => {
    const bytes = new Uint8Array([0, 65, 66, 0]).subarray(1, 3)
    expect(bytesToBase64(bytes)).toBe("QUI=")
  })

  it("collects recipients and attachment bytes", () => {
    const result = parseMessage({
      ...base,
      cc: "c@example.com",
      bcc: ["b@example.com"],
      attachments: [{ filename: "a.txt", content: "QUJD" }],
    })
    if (!result.ok) throw result.error
    expect(allRecipients(result.value).map((a) => a.email)).toEqual([
      "ada@example.com",
      "c@example.com",
      "b@example.com",
    ])
    expect(attachmentBytes(result.value)).toBe(3)
  })
})
