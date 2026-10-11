import { describe, expect, it } from "vitest"
import {
  errorFromResponse,
  type HttpResponse,
  jsonNumber,
  jsonString,
  MAX_ERROR_TEXT,
  postJson,
  scrubSecrets,
  sendRequest,
} from "../src/http.ts"
import { createMockFetch } from "../src/testing.ts"

function response(
  status: number,
  text: string,
  headers: Record<string, string> = {},
): HttpResponse {
  return { status, headers: new Headers(headers), text, json: undefined }
}

describe("scrubSecrets", () => {
  it("replaces every occurrence and ignores short secrets", () => {
    expect(scrubSecrets("key abcd and abcd", ["abcd"])).toBe("key [redacted] and [redacted]")
    expect(scrubSecrets("abc", ["abc", ""])).toBe("abc")
    expect(scrubSecrets("text", undefined)).toBe("text")
  })
})

describe("postJson / sendRequest", () => {
  it("posts JSON and parses the response", async () => {
    const mock = createMockFetch(() => ({ status: 200, body: { id: "x" } }))
    const result = await postJson(mock.fetch, "p", {
      url: "https://api.example.com/send",
      headers: {},
      body: { a: 1 },
    })
    expect(result.ok && result.value.json).toEqual({ id: "x" })
    expect(mock.requests[0]).toMatchObject({
      method: "POST",
      body: '{"a":1}',
      headers: { "content-type": "application/json", accept: "application/json" },
    })
  })

  it("leaves non-JSON bodies as text", async () => {
    const mock = createMockFetch(() => ({ status: 502, body: "<html>bad gateway</html>" }))
    const result = await sendRequest(mock.fetch, "p", {
      url: "https://x.example",
      headers: {},
      body: undefined,
    })
    expect(result.ok && result.value).toMatchObject({ status: 502, json: undefined })
  })

  it("sends no body on GET", async () => {
    const mock = createMockFetch()
    await sendRequest(mock.fetch, "p", {
      url: "https://x.example",
      method: "get",
      headers: {},
      body: { a: 1 },
    })
    expect(mock.requests[0]).toMatchObject({ method: "GET", body: "" })
  })

  it("returns aborted for a pre-aborted signal without a request", async () => {
    const mock = createMockFetch()
    const controller = new AbortController()
    controller.abort()
    const result = await sendRequest(mock.fetch, "p", {
      url: "https://x.example",
      headers: {},
      body: undefined,
      signal: controller.signal,
    })
    expect(!result.ok && result.error.kind).toBe("aborted")
    expect(mock.requests).toHaveLength(0)
  })

  it("maps a thrown fetch to network and scrubs secrets", async () => {
    const result = await sendRequest(
      async () => {
        throw new TypeError("connect failed with key s3cr3t-key")
      },
      "p",
      { url: "https://x.example", headers: {}, body: undefined, secrets: ["s3cr3t-key"] },
    )
    expect(!result.ok && result.error.kind).toBe("network")
    expect(!result.ok && result.error.message).not.toContain("s3cr3t-key")
  })

  it("maps a timeout to timeout", async () => {
    const result = await sendRequest(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason))
        }),
      "p",
      { url: "https://x.example", headers: {}, body: undefined, timeoutMs: 5 },
    )
    expect(!result.ok && result.error.kind).toBe("timeout")
  })

  it("maps a mid-flight abort to aborted", async () => {
    const controller = new AbortController()
    const pending = sendRequest(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason))
        }),
      "p",
      { url: "https://x.example", headers: {}, body: undefined, signal: controller.signal },
    )
    controller.abort()
    const result = await pending
    expect(!result.ok && result.error.kind).toBe("aborted")
  })
})

describe("errorFromResponse", () => {
  it("classifies, reads Retry-After and scrubs", () => {
    const error = errorFromResponse(
      "p",
      response(429, "too many for key-12345", { "retry-after": "3" }),
      {
        secrets: ["key-12345"],
        providerCode: "rate",
      },
    )
    expect(error.kind).toBe("rate_limited")
    expect(error.retryAfterMs).toBe(3000)
    expect(error.providerCode).toBe("rate")
    expect(error.message).toBe("p responded 429: too many for [redacted]")
  })

  it("honours a kind override and a provider message", () => {
    const error = errorFromResponse("p", response(429, "{}"), {
      kind: "quota",
      providerMessage: "daily limit",
    })
    expect(error.kind).toBe("quota")
    expect(error.message).toBe("p responded 429: daily limit")
  })

  it("truncates long bodies and omits empty ones", () => {
    const long = errorFromResponse("p", response(500, "x".repeat(1000)))
    expect(long.message.length).toBe("p responded 500: ".length + MAX_ERROR_TEXT)
    expect(errorFromResponse("p", response(503, "")).message).toBe("p responded 503")
  })
})

describe("json accessors", () => {
  it("reads typed fields only", () => {
    expect(jsonString({ a: "x", b: 1 }, "a")).toBe("x")
    expect(jsonString({ b: 1 }, "b")).toBeUndefined()
    expect(jsonNumber({ b: 1 }, "b")).toBe(1)
    expect(jsonNumber([1], "0")).toBeUndefined()
    expect(jsonString(null, "a")).toBeUndefined()
  })
})
