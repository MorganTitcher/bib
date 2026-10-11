import { describe, expect, it } from "vitest"
import {
  buildIndexNowPayloads,
  diffIndexNowManifest,
  indexNowKeyFile,
  isValidIndexNowKey,
} from "../src/indexnow.ts"

const KEY = "a1b2c3d4e5f6"

describe("IndexNow key", () => {
  it("validates and builds the key file", () => {
    expect(isValidIndexNowKey(KEY)).toBe(true)
    expect(isValidIndexNowKey("short")).toBe(false)
    expect(isValidIndexNowKey("has space1")).toBe(false)
    expect(indexNowKeyFile(KEY)).toEqual({
      path: `/${KEY}.txt`,
      body: KEY,
      contentType: "text/plain; charset=utf-8",
    })
    expect(() => indexNowKeyFile("bad")).toThrow()
  })
})

describe("buildIndexNowPayloads", () => {
  it("filters, dedupes and strips fragments", () => {
    const { payloads, rejected } = buildIndexNowPayloads({
      host: "Example.com",
      key: KEY,
      urls: [
        "https://example.com/a#top",
        "https://example.com/a",
        "http://example.com/b",
        "https://other.com/c",
        "https://u:p@example.com/d",
        "not a url",
      ],
    })
    expect(payloads).toEqual([
      { host: "example.com", key: KEY, urlList: ["https://example.com/a"] },
    ])
    expect(rejected.map((r) => r.reason)).toEqual([
      "duplicate",
      "not-https",
      "wrong-host",
      "has-credentials",
      "invalid-url",
    ])
  })

  it("batches at 10,000", () => {
    const urls = Array.from({ length: 10_001 }, (_, i) => `https://example.com/${i}`)
    const { payloads } = buildIndexNowPayloads({ host: "example.com", key: KEY, urls })
    expect(payloads.map((p) => p.urlList.length)).toEqual([10_000, 1])
  })

  it("validates host, key and keyLocation", () => {
    expect(() =>
      buildIndexNowPayloads({ host: "https://example.com", key: KEY, urls: [] }),
    ).toThrow()
    expect(() => buildIndexNowPayloads({ host: "example.com", key: "x", urls: [] })).toThrow()
    expect(() =>
      buildIndexNowPayloads({
        host: "example.com",
        key: KEY,
        keyLocation: "https://other.com/k.txt",
        urls: [],
      }),
    ).toThrow()
    const ok = buildIndexNowPayloads({
      host: "example.com",
      key: KEY,
      keyLocation: "https://example.com/k.txt",
      urls: ["https://example.com/"],
    })
    expect(ok.payloads[0]?.keyLocation).toBe("https://example.com/k.txt")
  })

  it("allows http when asked", () => {
    const { payloads } = buildIndexNowPayloads({
      host: "example.com",
      key: KEY,
      urls: ["http://example.com/"],
      allowHttp: true,
    })
    expect(payloads[0]?.urlList).toEqual(["http://example.com/"])
  })
})

describe("diffIndexNowManifest", () => {
  it("submits added, updated and removed URLs only", async () => {
    const first = await diffIndexNowManifest(
      {},
      { "https://example.com/a": "1", "https://example.com/b": "1" },
    )
    expect(first.added).toEqual(["https://example.com/a", "https://example.com/b"])
    const second = await diffIndexNowManifest(first.manifest, {
      "https://example.com/a": "1",
      "https://example.com/b": "2",
      "https://example.com/c": "1",
    })
    expect(second.unchanged).toEqual(["https://example.com/a"])
    expect(second.updated).toEqual(["https://example.com/b"])
    expect(second.added).toEqual(["https://example.com/c"])
    const third = await diffIndexNowManifest(second.manifest, { "https://example.com/a": "1" })
    expect(third.removed).toEqual(["https://example.com/b", "https://example.com/c"])
    expect(third.toSubmit).toEqual(["https://example.com/b", "https://example.com/c"])
  })
})
