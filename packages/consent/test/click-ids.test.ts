import { describe, expect, it } from "vitest"
import {
  CLICK_ID_PARAMS,
  CLICK_ID_REGISTRY,
  extractClickIds,
  primaryClickId,
} from "../src/click-ids.ts"

describe("CLICK_ID_REGISTRY", () => {
  it("includes the verified core set with lowercase, unique names", () => {
    for (const p of [
      "gclid",
      "gbraid",
      "wbraid",
      "msclkid",
      "fbclid",
      "li_fat_id",
      "ttclid",
      "epik",
      "rdt_cid",
      "sccid",
      "sc_click_id",
    ]) {
      expect(CLICK_ID_PARAMS.has(p)).toBe(true)
    }
    const names = CLICK_ID_REGISTRY.map((d) => d.param)
    expect(new Set(names).size).toBe(names.length)
    for (const n of names) expect(n).toBe(n.toLowerCase())
  })

  it("does not treat share or organic markers as click IDs", () => {
    for (const p of ["srsltid", "igshid", "si"]) expect(CLICK_ID_PARAMS.has(p)).toBe(false)
  })
})

describe("extractClickIds", () => {
  it("returns every recognised ID in precedence order", () => {
    const ids = extractClickIds("https://x.test/?fbclid=F1&gclid=G1&msclkid=M1")
    expect(ids.map((i) => i.param)).toEqual(["gclid", "msclkid", "fbclid"])
    expect(ids[0]).toEqual({
      param: "gclid",
      platform: "google_ads",
      channel: "paid_search",
      value: "G1",
    })
  })

  it("matches names case-insensitively (Snapchat sends ScCid)", () => {
    expect(primaryClickId("?ScCid=abc-123")?.platform).toBe("snapchat")
  })

  it("keeps iOS-safe Google IDs", () => {
    expect(primaryClickId("?wbraid=Cj0K")?.param).toBe("wbraid")
    expect(primaryClickId("?gbraid=0AAA")?.param).toBe("gbraid")
  })

  it.each([
    ["blank", "?gclid="],
    ["whitespace inside", "?gclid=a%20b"],
    ["control char", "?gclid=a%0Ab"],
    ["script", "?gclid=%3Cscript%3E"],
    ["too long", `?gclid=${"a".repeat(513)}`],
  ])("skips a %s value", (_name, input) => {
    expect(extractClickIds(input)).toEqual([])
  })

  it("accepts a 512-character value and URL-safe punctuation", () => {
    expect(primaryClickId(`?gclid=${"a".repeat(512)}`)?.value).toHaveLength(512)
    expect(primaryClickId("?fbclid=IwAR0_x-y.z~1")?.value).toBe("IwAR0_x-y.z~1")
  })

  it("supports a custom registry", () => {
    const registry = [{ param: "myclid", platform: "inhouse", channel: "display" as const }]
    expect(primaryClickId("?myclid=1&gclid=2", { registry })?.platform).toBe("inhouse")
  })

  it("returns nothing for input without IDs", () => {
    expect(primaryClickId("https://x.test/")).toBeUndefined()
  })
})
