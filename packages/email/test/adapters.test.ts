import { describe, expect, it } from "vitest"
import { createPostmarkProvider, toPostmarkPayload } from "../src/providers/postmark.ts"
import { createResendProvider, toResendPayload } from "../src/providers/resend.ts"
import {
  createSendGridProvider,
  SENDGRID_MAX_CATEGORIES,
  toSendGridPayload,
} from "../src/providers/sendgrid.ts"
import { createSesProvider, sesErrorType, toSesPayload } from "../src/providers/ses.ts"
import { contractMessage, createMockFetch } from "../src/testing.ts"

const rich = contractMessage({
  from: { email: "sender@example.com", name: "Sénder" },
  to: [{ email: "a@example.com", name: "Ada" }, { email: "b@example.com" }],
  cc: [{ email: "c@example.com" }],
  bcc: [{ email: "d@example.com" }],
  replyTo: [{ email: "reply@example.com" }],
  html: "<p>Hi</p>",
  text: "Hi",
  tags: [
    { name: "category", value: "receipt" },
    { name: "flow", value: "billing" },
  ],
  headers: { "X-Entity-Ref": "abc" },
  metadata: { orderId: "42" },
  attachments: [
    {
      filename: "logo.png",
      content: "aGk=",
      contentType: "image/png",
      disposition: "inline",
      contentId: "logo",
      size: 2,
    },
  ],
})

describe("resend", () => {
  it("maps the payload", () => {
    const body = toResendPayload(rich)
    expect(body.from).toContain("<sender@example.com>")
    expect(body.to).toEqual(["Ada <a@example.com>", "b@example.com"])
    expect(body.cc).toEqual(["c@example.com"])
    expect(body.reply_to).toEqual(["reply@example.com"])
    expect(body.tags).toEqual([
      { name: "category", value: "receipt" },
      { name: "flow", value: "billing" },
    ])
    expect(body.headers).toEqual({ "X-Entity-Ref": "abc" })
    expect(body.attachments).toEqual([
      { filename: "logo.png", content: "aGk=", content_type: "image/png", content_id: "logo" },
    ])
  })

  it("posts to /emails with bearer auth and the idempotency key", async () => {
    const mock = createMockFetch(() => ({ status: 200, body: { id: "msg_9" } }))
    const provider = createResendProvider({
      apiKey: "re_key",
      fetch: mock.fetch,
      baseUrl: "https://x.test/",
    })
    const outcome = await provider.send(contractMessage({ idempotencyKey: "k1" }))
    expect(outcome.ok && outcome.value.messageId).toBe("msg_9")
    expect(mock.requests[0]?.url).toBe("https://x.test/emails")
    expect(mock.requests[0]?.headers.authorization).toBe("Bearer re_key")
    expect(mock.requests[0]?.headers["idempotency-key"]).toBe("k1")
  })

  it.each([
    [429, "daily_quota_exceeded", "quota"],
    [409, "concurrent_idempotent_requests", "in_progress"],
    [409, "invalid_idempotent_request", "idempotency_conflict"],
    [400, "invalid_idempotency_key", "validation"],
    [422, "validation_error", "rejected"],
  ])("maps %i %s to %s", async (status, name, kind) => {
    const mock = createMockFetch(() => ({ status, body: { name, message: "nope" } }))
    const outcome = await createResendProvider({ apiKey: "re_key", fetch: mock.fetch }).send(
      contractMessage(),
    )
    expect(!outcome.ok && outcome.error.kind).toBe(kind)
    expect(!outcome.ok && outcome.error.providerCode).toBe(name)
  })

  it("reports an empty key as configuration without a request", async () => {
    const mock = createMockFetch()
    const provider = createResendProvider({ apiKey: "", fetch: mock.fetch })
    const outcome = await provider.send(contractMessage())
    expect(!outcome.ok && outcome.error.kind).toBe("configuration")
    expect(mock.requests).toHaveLength(0)
    expect((await provider.healthCheck?.())?.ok).toBe(false)
  })

  it("treats a 2xx without an id as unknown", async () => {
    const mock = createMockFetch(() => ({ status: 200, body: {} }))
    const outcome = await createResendProvider({ apiKey: "re_key", fetch: mock.fetch }).send(
      contractMessage(),
    )
    expect(!outcome.ok && outcome.error.kind).toBe("unknown")
  })
})

describe("postmark", () => {
  it("maps the payload", () => {
    const body = toPostmarkPayload(rich, "broadcast")
    expect(body.To).toBe("Ada <a@example.com>, b@example.com")
    expect(body.MessageStream).toBe("broadcast")
    expect(body.Tag).toBe("receipt")
    expect(body.Metadata).toEqual({ orderId: "42", tag_category: "receipt", tag_flow: "billing" })
    expect(body.Headers).toEqual([{ Name: "X-Entity-Ref", Value: "abc" }])
    expect(body.Attachments).toEqual([
      { Name: "logo.png", Content: "aGk=", ContentType: "image/png", ContentID: "cid:logo" },
    ])
    expect(toPostmarkPayload(contractMessage()).MessageStream).toBe("outbound")
  })

  it("sends the server token header", async () => {
    const mock = createMockFetch(() => ({ status: 200, body: { MessageID: "pm-2", ErrorCode: 0 } }))
    const outcome = await createPostmarkProvider({ serverToken: "tok-1", fetch: mock.fetch }).send(
      contractMessage(),
    )
    expect(outcome.ok && outcome.value.messageId).toBe("pm-2")
    expect(mock.requests[0]?.url).toBe("https://api.postmarkapp.com/email")
    expect(mock.requests[0]?.headers["x-postmark-server-token"]).toBe("tok-1")
  })

  it("maps ErrorCode 10 to authentication and 422 to rejected", async () => {
    const mock = createMockFetch(() => ({
      status: 422,
      body: { ErrorCode: 10, Message: "Bad token" },
    }))
    const provider = createPostmarkProvider({ serverToken: "tok-1", fetch: mock.fetch })
    const auth = await provider.send(contractMessage())
    expect(!auth.ok && auth.error.kind).toBe("authentication")
    mock.respond(() => ({ status: 422, body: { ErrorCode: 406, Message: "Inactive recipient" } }))
    const rejected = await provider.send(contractMessage())
    expect(!rejected.ok && rejected.error.kind).toBe("rejected")
    expect(!rejected.ok && rejected.error.providerCode).toBe("406")
    expect(!rejected.ok && rejected.error.message).toContain("Inactive recipient")
  })

  it("does not forward idempotency keys", async () => {
    const mock = createMockFetch(() => ({ status: 200, body: { MessageID: "pm-2", ErrorCode: 0 } }))
    await createPostmarkProvider({ serverToken: "tok-1", fetch: mock.fetch }).send(
      contractMessage(),
      {
        idempotencyKey: "k",
      },
    )
    expect(Object.values(mock.requests[0]?.headers ?? {})).not.toContain("k")
  })
})

describe("sendgrid", () => {
  it("maps the payload", () => {
    const body = toSendGridPayload(rich)
    expect(body.personalizations).toEqual([
      {
        to: [{ email: "a@example.com", name: "Ada" }, { email: "b@example.com" }],
        cc: [{ email: "c@example.com" }],
        bcc: [{ email: "d@example.com" }],
      },
    ])
    expect(body.content).toEqual([
      { type: "text/plain", value: "Hi" },
      { type: "text/html", value: "<p>Hi</p>" },
    ])
    expect(body.reply_to).toEqual({ email: "reply@example.com" })
    expect(body.categories).toEqual(["receipt", "billing"])
    expect(body.custom_args).toEqual({
      orderId: "42",
      tag_category: "receipt",
      tag_flow: "billing",
    })
  })

  it("uses reply_to_list for several reply-to addresses and caps categories", () => {
    const tags = Array.from({ length: 12 }, (_, i) => ({ name: `t${i}`, value: `v${i}` }))
    const body = toSendGridPayload(
      contractMessage({ replyTo: [{ email: "a@example.com" }, { email: "b@example.com" }], tags }),
    )
    expect(body.reply_to).toBeUndefined()
    expect(body.reply_to_list).toHaveLength(2)
    expect(body.categories).toHaveLength(SENDGRID_MAX_CATEGORIES)
  })

  it("returns an empty id when x-message-id is missing and extracts error messages", async () => {
    const mock = createMockFetch(() => ({ status: 202 }))
    const provider = createSendGridProvider({ apiKey: "SG.key", fetch: mock.fetch })
    const outcome = await provider.send(contractMessage())
    expect(outcome.ok && outcome.value.messageId).toBe("")
    expect(mock.requests[0]?.url).toBe("https://api.sendgrid.com/v3/mail/send")
    mock.respond(() => ({
      status: 400,
      body: { errors: [{ field: "from", message: "is required" }] },
    }))
    const failed = await provider.send(contractMessage())
    expect(!failed.ok && failed.error.message).toContain("from: is required")
  })
})

describe("ses", () => {
  const now = () => new Date("2026-10-11T00:00:00Z")
  const credentials = { accessKeyId: "AKIDTEST", secretAccessKey: "secret-key-value" }

  it("maps the payload", () => {
    const body = toSesPayload(rich, "tracking")
    expect(body.Destination).toEqual({
      ToAddresses: ["Ada <a@example.com>", "b@example.com"],
      CcAddresses: ["c@example.com"],
      BccAddresses: ["d@example.com"],
    })
    expect(body.FromEmailAddress).toBe("=?UTF-8?B?U8OpbmRlcg==?= <sender@example.com>")
    expect(body.EmailTags).toEqual([
      { Name: "category", Value: "receipt" },
      { Name: "flow", Value: "billing" },
    ])
    expect(body.ConfigurationSetName).toBe("tracking")
    const simple = (body.Content as { Simple: Record<string, unknown> }).Simple
    expect(simple.Attachments).toEqual([
      {
        FileName: "logo.png",
        ContentType: "image/png",
        ContentDisposition: "INLINE",
        ContentTransferEncoding: "BASE64",
        RawContent: "aGk=",
        ContentId: "logo",
      },
    ])
  })

  it("signs the request and never sends a host header", async () => {
    const mock = createMockFetch(() => ({ status: 200, body: { MessageId: "ses-9" } }))
    const provider = createSesProvider({ region: "eu-west-1", credentials, fetch: mock.fetch, now })
    const outcome = await provider.send(contractMessage())
    expect(outcome.ok && outcome.value.messageId).toBe("ses-9")
    const req = mock.requests[0]
    expect(req?.url).toBe("https://email.eu-west-1.amazonaws.com/v2/email/outbound-emails")
    expect(req?.headers.host).toBeUndefined()
    expect(req?.headers["x-amz-date"]).toBe("20261011T000000Z")
    expect(req?.headers.authorization).toContain(
      "Credential=AKIDTEST/20261011/eu-west-1/ses/aws4_request",
    )
  })

  it("resolves rotating credentials and sends the session token", async () => {
    const mock = createMockFetch(() => ({ status: 200, body: { MessageId: "ses-9" } }))
    const provider = createSesProvider({
      region: "us-east-1",
      credentials: async () => ({ ...credentials, sessionToken: "session-token" }),
      fetch: mock.fetch,
      now,
    })
    await provider.send(contractMessage())
    expect(mock.requests[0]?.headers["x-amz-security-token"]).toBe("session-token")
  })

  it("reports credential failures as configuration", async () => {
    const mock = createMockFetch()
    const throwing = createSesProvider({
      region: "us-east-1",
      credentials: async () => {
        throw new Error("no profile")
      },
      fetch: mock.fetch,
    })
    const outcome = await throwing.send(contractMessage())
    expect(!outcome.ok && outcome.error.kind).toBe("configuration")
    const empty = createSesProvider({ region: "", credentials, fetch: mock.fetch })
    expect((await empty.send(contractMessage())).ok).toBe(false)
    expect(mock.requests).toHaveLength(0)
  })

  it.each([
    ["TooManyRequestsException", 429, "rate_limited"],
    ["LimitExceededException", 400, "quota"],
    ["MessageRejected", 400, "rejected"],
    ["MailFromDomainNotVerifiedException", 400, "configuration"],
    ["AccessDeniedException", 403, "authentication"],
  ])("maps %s to %s", async (type, status, kind) => {
    const mock = createMockFetch(() => ({
      status,
      body: { message: "x" },
      headers: { "x-amzn-errortype": `${type}:http://internal` },
    }))
    const provider = createSesProvider({ region: "us-east-1", credentials, fetch: mock.fetch, now })
    const outcome = await provider.send(contractMessage())
    expect(!outcome.ok && outcome.error.kind).toBe(kind)
    expect(!outcome.ok && outcome.error.providerCode).toBe(type)
  })

  it("reads the error type from the header or the body", () => {
    const res = (headers: Record<string, string>, json: unknown) => ({
      status: 400,
      headers: new Headers(headers),
      text: "",
      json,
    })
    expect(sesErrorType(res({ "x-amzn-errortype": "MessageRejected:http://x" }, undefined))).toBe(
      "MessageRejected",
    )
    expect(sesErrorType(res({}, { __type: "com.amazonaws#ThrottlingException" }))).toBe(
      "ThrottlingException",
    )
    expect(sesErrorType(res({}, {}))).toBeUndefined()
  })

  it("health check calls GetAccount", async () => {
    const mock = createMockFetch(() => ({ status: 200, body: {} }))
    const provider = createSesProvider({ region: "us-east-1", credentials, fetch: mock.fetch, now })
    expect((await provider.healthCheck?.())?.ok).toBe(true)
    expect(mock.requests[0]?.method).toBe("GET")
    expect(mock.requests[0]?.url).toBe("https://email.us-east-1.amazonaws.com/v2/email/account")
  })
})
