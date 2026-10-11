import { describe, expect, it } from "vitest"
import {
  amzDate,
  computeSignature,
  deriveSigningKey,
  signRequest,
  uriEncode,
} from "../src/providers/sigv4.ts"

// Vectors from the AWS SigV4 test suite (aws-sig-v4-test-suite) and the IAM
// "Examples of how to derive a signing key" page, checked 2026-10-11.
const credentials = {
  accessKeyId: "AKIDEXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
}
const base = {
  headers: {},
  body: "",
  region: "us-east-1",
  service: "service",
  now: new Date("2015-08-30T12:36:00Z"),
}

describe("deriveSigningKey", () => {
  it("matches the documented derivation", () => {
    const key = deriveSigningKey(credentials.secretAccessKey, "20120215", "us-east-1", "iam")
    expect(Buffer.from(key).toString("hex")).toBe(
      "f4780e2d9f65fa895f9c67b32ce1baf0b0d8a43505a000a1a9e090d414db404d",
    )
  })
})

describe("computeSignature", () => {
  it("get-vanilla", () => {
    const parts = computeSignature(
      { ...base, method: "GET", url: "https://example.amazonaws.com/" },
      credentials,
    )
    expect(parts.signedHeaders).toBe("host;x-amz-date")
    expect(parts.credentialScope).toBe("20150830/us-east-1/service/aws4_request")
    expect(parts.signature).toBe("5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31")
  })

  it("post-vanilla", () => {
    const parts = computeSignature(
      { ...base, method: "POST", url: "https://example.amazonaws.com/" },
      credentials,
    )
    expect(parts.signature).toBe("5da7c1a2acd57cee7505fc6676e4e544621c30862966e37dddb68e92efbe5d6b")
  })

  it("get-vanilla-query-order-key-case sorts parameters", () => {
    const parts = computeSignature(
      { ...base, method: "GET", url: "https://example.amazonaws.com/?Param2=value2&Param1=value1" },
      credentials,
    )
    expect(parts.canonicalRequest.split("\n")[2]).toBe("Param1=value1&Param2=value2")
    expect(parts.signature).toBe("b97d918cfa904a5beff61c982a1b6f458b799221646efd99d3219ec94cdf2500")
  })

  it("signs the session token when present", () => {
    const parts = computeSignature(
      { ...base, method: "GET", url: "https://example.amazonaws.com/" },
      { ...credentials, sessionToken: "token" },
    )
    expect(parts.signedHeaders).toBe("host;x-amz-date;x-amz-security-token")
  })
})

describe("signRequest", () => {
  it("returns the headers to send", () => {
    const headers = signRequest(
      {
        ...base,
        method: "GET",
        url: "https://example.amazonaws.com/",
        headers: { "Content-Type": "a" },
      },
      credentials,
    )
    expect(headers.host).toBe("example.amazonaws.com")
    expect(headers["x-amz-date"]).toBe("20150830T123600Z")
    expect(headers["content-type"]).toBe("a")
    expect(headers.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/20150830\/us-east-1\/service\/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=[0-9a-f]{64}$/,
    )
  })
})

describe("helpers", () => {
  it("uriEncode keeps unreserved characters and uppercases hex", () => {
    expect(uriEncode("a-b_c.d~e")).toBe("a-b_c.d~e")
    expect(uriEncode("a b/ü")).toBe("a%20b%2F%C3%BC")
    expect(uriEncode("*!'()")).toBe("%2A%21%27%28%29")
  })

  it("amzDate formats basic ISO-8601", () => {
    expect(amzDate(new Date("2015-08-30T12:36:00.123Z"))).toBe("20150830T123600Z")
  })
})
