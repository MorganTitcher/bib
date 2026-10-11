import { describe, expect, it } from "vitest"
import {
  addressProblem,
  encodeHeaderWord,
  formatAddress,
  isValidEmail,
  MAX_EMAIL_LENGTH,
  normalizeEmail,
  parseAddress,
  parseAddressList,
} from "../src/address.ts"

describe("addressProblem", () => {
  it.each([
    ["ada@example.com"],
    ["first.last+tag@sub.example.co.uk"],
    ["user@xn--bcher-kva.example"],
  ])("accepts %s", (email) => {
    expect(addressProblem(email)).toBeUndefined()
    expect(isValidEmail(email)).toBe(true)
  })

  it.each([
    ["", "address is empty"],
    ["@example.com", "address has no local part"],
    ["ada@", "address has no domain"],
    [".ada@example.com", "local part starts or ends with a dot"],
    ["a..da@example.com", "local part has consecutive dots"],
    ["a da@example.com", "local part contains a character that needs quoting"],
    ["ada@localhost", "domain has no top-level domain"],
    ["ada@example..com", "domain has an empty label"],
    ["ada@example.c0m", "top-level domain must be letters (or punycode)"],
  ])("rejects %j: %s", (email, reason) => {
    expect(addressProblem(email)).toBe(reason)
    expect(isValidEmail(email)).toBe(false)
  })

  it("enforces length limits", () => {
    expect(addressProblem(`${"a".repeat(65)}@example.com`)).toBeDefined()
    expect(addressProblem(`a@${"b".repeat(MAX_EMAIL_LENGTH)}.com`)).toBeDefined()
  })
})

describe("normalizeEmail", () => {
  it("lowercases the domain only and trims", () => {
    expect(normalizeEmail("  Ada.Lovelace@Example.COM ")).toBe("Ada.Lovelace@example.com")
  })
})

describe("parseAddress", () => {
  it("parses a bare address", () => {
    expect(parseAddress("ada@Example.com")).toEqual({
      ok: true,
      value: { email: "ada@example.com" },
    })
  })

  it("parses a display name", () => {
    expect(parseAddress("Ada Lovelace <ada@example.com>")).toEqual({
      ok: true,
      value: { email: "ada@example.com", name: "Ada Lovelace" },
    })
  })

  it("unquotes a quoted display name with escapes", () => {
    expect(parseAddress('"Lovelace, \\"Ada\\"" <ada@example.com>')).toEqual({
      ok: true,
      value: { email: "ada@example.com", name: 'Lovelace, "Ada"' },
    })
  })

  it("accepts an object and drops an empty name", () => {
    expect(parseAddress({ email: "ada@example.com", name: "  " })).toEqual({
      ok: true,
      value: { email: "ada@example.com" },
    })
  })

  it.each([
    ["Ada <ada@example.com>\r\nBcc: x@example.com", "address contains a line break"],
    ["ada@example.com>", "address has '>' without '<'"],
    ["Ada <ada@example.com", "address has unbalanced angle brackets"],
    ['Ada" <ada@example.com>', "display name has an unbalanced quote"],
    ['"Ada"x" <ada@example.com>', "display name has an unescaped quote"],
    ["Ada <not-an-address>", "address has no '@'"],
    ["Ada <ada@>", "address has no domain"],
  ])("rejects %j", (input, reason) => {
    expect(parseAddress(input)).toEqual({ ok: false, error: reason })
  })

  it("rejects a non-address value", () => {
    expect(parseAddress(42 as unknown as string).ok).toBe(false)
  })
})

describe("formatAddress", () => {
  it("renders bare, plain and quoted names", () => {
    expect(formatAddress({ email: "ada@example.com" })).toBe("ada@example.com")
    expect(formatAddress({ email: "ada@example.com", name: "Ada" })).toBe("Ada <ada@example.com>")
    expect(formatAddress({ email: "ada@example.com", name: 'Lovelace, "Ada"' })).toBe(
      '"Lovelace, \\"Ada\\"" <ada@example.com>',
    )
  })

  it("round-trips through parseAddress", () => {
    const address = { email: "ada@example.com", name: 'Back\\slash, "q"' }
    expect(parseAddress(formatAddress(address))).toEqual({ ok: true, value: address })
  })

  it("encodes non-ASCII names on request", () => {
    expect(
      formatAddress({ email: "s@example.com", name: "Sénder" }, { encodeNonAscii: true }),
    ).toBe("=?UTF-8?B?U8OpbmRlcg==?= <s@example.com>")
    expect(
      formatAddress({ email: "s@example.com", name: "Sender" }, { encodeNonAscii: true }),
    ).toBe("Sender <s@example.com>")
  })
})

describe("encodeHeaderWord", () => {
  it("splits long values into words without breaking code points", () => {
    const value = "é".repeat(40)
    const words = encodeHeaderWord(value).split(" ")
    expect(words.length).toBeGreaterThan(1)
    for (const word of words) expect(word.length).toBeLessThanOrEqual(75)
    const decoded = words
      .map((w) => Buffer.from(w.slice(10, -2), "base64").toString("utf8"))
      .join("")
    expect(decoded).toBe(value)
  })
})

describe("parseAddressList", () => {
  it("accepts a single address or a list", () => {
    expect(parseAddressList("a@example.com")).toEqual({
      ok: true,
      value: [{ email: "a@example.com" }],
    })
    expect(parseAddressList(["a@example.com", { email: "b@example.com" }]).ok).toBe(true)
  })

  it("reports every bad entry with its index", () => {
    const result = parseAddressList(["bad", "a@example.com", "@x.com"])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.map((p) => p.index)).toEqual([0, 2])
  })
})
