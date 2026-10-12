import { describe, expect, it } from "vitest"
import {
  base64ToBytes,
  base64UrlToBytes,
  bytesToBase64,
  bytesToBase64Url,
  bytesToHex,
} from "../src/encoding.ts"

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text)

describe("bytesToHex", () => {
  it("writes two lowercase digits per byte", () => {
    expect(bytesToHex(new Uint8Array([0, 15, 16, 255]))).toBe("000f10ff")
    expect(bytesToHex(new Uint8Array())).toBe("")
  })
})

describe("base64", () => {
  it("matches RFC 4648 test vectors", () => {
    const vectors: [string, string][] = [
      ["", ""],
      ["f", "Zg=="],
      ["fo", "Zm8="],
      ["foo", "Zm9v"],
      ["foobar", "Zm9vYmFy"],
    ]
    for (const [plain, encoded] of vectors) {
      expect(bytesToBase64(utf8(plain))).toBe(encoded)
      expect(base64ToBytes(encoded)).toEqual(utf8(plain))
    }
  })

  it("encodes a subarray view of bytes", () => {
    const bytes = new Uint8Array([0, 65, 66, 0]).subarray(1, 3)
    expect(bytesToBase64(bytes)).toBe("QUI=")
  })

  it("round-trips large inputs across chunk boundaries", () => {
    const bytes = Uint8Array.from({ length: 100_003 }, (_, i) => i % 256)
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes)
  })

  it.each(["Zg", "Zg=", "Z===", "Zm9v!", "Zm-v", " Zm9v"])("rejects %j", (text) => {
    expect(base64ToBytes(text)).toBeUndefined()
  })
})

describe("base64url", () => {
  it("uses the URL-safe alphabet without padding", () => {
    const bytes = new Uint8Array([0xfb, 0xff, 0xbf])
    expect(bytesToBase64(bytes)).toBe("+/+/")
    expect(bytesToBase64Url(bytes)).toBe("-_-_")
    expect(bytesToBase64Url(utf8("f"))).toBe("Zg")
  })

  it("round-trips", () => {
    for (const text of ["", "a", "ab", "abc", "héllo 😀"]) {
      expect(base64UrlToBytes(bytesToBase64Url(utf8(text)))).toEqual(utf8(text))
    }
  })

  it.each(["a", "Zg==", "Zm9v+", "a/b"])("rejects %j", (text) => {
    expect(base64UrlToBytes(text)).toBeUndefined()
  })
})
