import { describe, expect, it } from "vitest"
import { EmailError } from "../src/errors.ts"
import { createConsoleProvider } from "../src/providers/console.ts"
import { createMemoryProvider } from "../src/providers/memory.ts"
import { createSmtpProvider } from "../src/providers/smtp.ts"
import { contractMessage, createMockFetch } from "../src/testing.ts"

describe("console provider", () => {
  it("writes one redacted JSON line per send", async () => {
    const lines: string[] = []
    const provider = createConsoleProvider({
      write: (line) => lines.push(line),
      now: () => new Date("2026-10-11T00:00:00Z"),
    })
    const outcome = await provider.send(contractMessage(), { idempotencyKey: "k1" })
    expect(outcome).toEqual({
      ok: true,
      value: {
        provider: "console",
        messageId: "console-1",
        acceptedAt: "2026-10-11T00:00:00.000Z",
      },
    })
    const record = JSON.parse(lines[0] ?? "{}")
    expect(record).toMatchObject({
      provider: "console",
      messageId: "console-1",
      idempotencyKey: "k1",
    })
    expect(record.message.to).toEqual(["r***@example.com"])
    expect(lines[0]).not.toContain("Contract body")
  })

  it("can log the full message", async () => {
    const lines: string[] = []
    await createConsoleProvider({ write: (l) => lines.push(l), redact: false }).send(
      contractMessage(),
    )
    expect(lines[0]).toContain("recipient@example.com")
  })
})

describe("memory provider", () => {
  it("records sends and scripted failures", async () => {
    const memory = createMemoryProvider()
    memory.failNext(new EmailError("unavailable", "down"))
    expect((await memory.send(contractMessage())).ok).toBe(false)
    expect((await memory.send(contractMessage())).ok).toBe(true)
    expect(memory.calls).toBe(2)
    expect(memory.sent).toHaveLength(1)
    expect(memory.last()?.result.messageId).toBe("memory-1")

    memory.failWith((m) => (m.subject === "fail" ? new EmailError("rejected", "no") : undefined))
    expect((await memory.send(contractMessage({ subject: "fail" }))).ok).toBe(false)
    memory.reset()
    expect(memory.calls).toBe(0)
    expect(memory.sent).toHaveLength(0)
  })

  it("honours abort and capabilities", async () => {
    const memory = createMemoryProvider({ capabilities: { maxRecipients: 1 } })
    const controller = new AbortController()
    controller.abort()
    const aborted = await memory.send(contractMessage(), { signal: controller.signal })
    expect(!aborted.ok && aborted.error.kind).toBe("aborted")
    const over = await memory.send(contractMessage({ cc: [{ email: "c@example.com" }] }))
    expect(!over.ok && over.error.kind).toBe("validation")
  })
})

describe("smtp scaffold", () => {
  it("returns a configuration error naming the missing dependency", async () => {
    const smtp = createSmtpProvider({ host: "smtp.example.com", port: 587 })
    const outcome = await smtp.send(contractMessage())
    expect(!outcome.ok && outcome.error.kind).toBe("configuration")
    expect(!outcome.ok && outcome.error.message).toContain("nodemailer")
    expect((await smtp.healthCheck?.())?.ok).toBe(false)
  })
})

describe("createMockFetch", () => {
  it("records requests and can change its responder", async () => {
    const mock = createMockFetch()
    await mock.fetch("https://x.example", { method: "post", headers: { "X-A": "1" }, body: "b" })
    expect(mock.requests[0]).toEqual({
      url: "https://x.example",
      method: "POST",
      headers: { "x-a": "1" },
      body: "b",
    })
    mock.respond(() => ({ status: 500, body: "nope" }))
    const res = await mock.fetch("https://x.example", {})
    expect(res.status).toBe(500)
    expect(await res.text()).toBe("nope")
  })
})
