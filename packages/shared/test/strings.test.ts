import { describe, expect, it } from "vitest"
import {
  camelCase,
  escapeHtml,
  kebabCase,
  normalizeWhitespace,
  pascalCase,
  pluralize,
  slugify,
  snakeCase,
  splitWords,
  titleCase,
  truncate,
  truncateAtWord,
  upperFirst,
} from "../src/strings.ts"

describe("normalizeWhitespace", () => {
  it("collapses and trims", () => {
    expect(normalizeWhitespace("  a \n\t b  ")).toBe("a b")
    expect(normalizeWhitespace("")).toBe("")
  })
})

describe("slugify", () => {
  it("strips accents and punctuation", () => {
    expect(slugify("Café Déjà Vu — Q3 Plan!")).toBe("cafe-deja-vu-q3-plan")
    expect(slugify("  --Hello__World--  ")).toBe("hello-world")
    expect(slugify("")).toBe("")
    expect(slugify("!!!")).toBe("")
  })
  it("keeps non-Latin letters", () => {
    expect(slugify("Привет мир")).toBe("привет-мир")
  })
  it("truncates without a trailing hyphen", () => {
    expect(slugify("hello wonderful world", { maxLength: 6 })).toBe("hello")
  })
})

describe("truncate", () => {
  it("cuts by grapheme with an ellipsis", () => {
    expect(truncate("hello world", 8)).toBe("hello w…")
    expect(truncate("short", 10)).toBe("short")
    expect(truncate("👍🏽👍🏽👍🏽", 2)).toBe("👍🏽…")
    expect(truncate("hello", 3, "...")).toBe("...")
    expect(truncate("hello", 0)).toBe("")
  })
  it("truncateAtWord keeps whole words", () => {
    expect(truncateAtWord("The quick brown fox jumps", 15)).toBe("The quick…")
    expect(truncateAtWord("short text", 20)).toBe("short text")
    expect(truncateAtWord("Supercalifragilistic", 8)).toBe("Superca…")
  })
})

describe("case conversion", () => {
  it("splits words on boundaries", () => {
    expect(splitWords("parseHTTPResponse")).toEqual(["parse", "http", "response"])
    expect(splitWords("snake_case-and kebab")).toEqual(["snake", "case", "and", "kebab"])
    expect(splitWords("")).toEqual([])
  })
  it("converts between cases", () => {
    expect(camelCase("Hello world_foo")).toBe("helloWorldFoo")
    expect(pascalCase("hello world")).toBe("HelloWorld")
    expect(snakeCase("helloWorld")).toBe("hello_world")
    expect(kebabCase("parseHTTPResponse")).toBe("parse-http-response")
    expect(upperFirst("hello")).toBe("Hello")
    expect(upperFirst("")).toBe("")
  })
  it("title-cases with small words", () => {
    expect(titleCase("the lord of the rings")).toBe("The Lord of the Rings")
    expect(titleCase("an API for the web")).toBe("An API for the Web")
    expect(titleCase("what are you looking at")).toBe("What Are You Looking At")
  })
})

describe("escapeHtml", () => {
  it("escapes the five special characters", () => {
    expect(escapeHtml(`<a href="x">Tom & 'Jerry'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/a&gt;",
    )
  })
})

describe("pluralize", () => {
  it("handles regular and irregular forms", () => {
    expect(pluralize("invoice", 1)).toBe("invoice")
    expect(pluralize("invoice", -1)).toBe("invoice")
    expect(pluralize("invoice", 0)).toBe("invoices")
    expect(pluralize("person", 2)).toBe("people")
    expect(pluralize("Person", 2)).toBe("People")
    expect(pluralize("city", 2)).toBe("cities")
    expect(pluralize("day", 2)).toBe("days")
    expect(pluralize("box", 2)).toBe("boxes")
    expect(pluralize("match", 2)).toBe("matches")
    expect(pluralize("cactus", 2, "cacti")).toBe("cacti")
  })
})
