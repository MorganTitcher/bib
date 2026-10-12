import { describe, expect, it } from "vitest"
import { buildLlmsTxt, escapeMarkdownInline } from "../src/llms-txt.ts"

describe("buildLlmsTxt", () => {
  it("builds the documented structure", () => {
    const txt = buildLlmsTxt({
      title: "Example",
      summary: "A tool.\nFor teams.",
      details: ["Some detail."],
      baseUrl: "https://example.com",
      sections: [
        { title: "Docs", links: [{ title: "Start", url: "/docs/start", notes: "first steps" }] },
      ],
      optional: [{ title: "Blog", url: "https://example.com/blog" }],
    })
    expect(txt).toBe(
      "# Example\n\n> A tool.\n> For teams.\n\nSome detail.\n\n## Docs\n\n- [Start](https://example.com/docs/start): first steps\n\n## Optional\n\n- [Blog](https://example.com/blog)\n",
    )
  })

  it("escapes link text and encodes parentheses in URLs", () => {
    const txt = buildLlmsTxt({
      title: "X",
      sections: [{ title: "S", links: [{ title: "a]b(c)", url: "https://example.com/a (b)" }] }],
    })
    expect(txt).toContain("- [a\\]b(c)](https://example.com/a%20%28b%29)")
  })

  it("skips empty sections and rejects bad input", () => {
    expect(buildLlmsTxt({ title: "X", sections: [{ title: "Empty", links: [] }] })).toBe("# X\n")
    expect(() => buildLlmsTxt({ title: " " })).toThrow()
    expect(() =>
      buildLlmsTxt({ title: "X", sections: [{ title: "Optional", links: [] }] }),
    ).toThrow(/optional/)
    expect(() =>
      buildLlmsTxt({
        title: "X",
        sections: [{ title: "S", links: [{ title: "a", url: "/rel" }] }],
      }),
    ).toThrow(/absolute/)
    expect(() =>
      buildLlmsTxt({
        title: "X",
        sections: [{ title: "S", links: [{ title: "", url: "https://e.com" }] }],
      }),
    ).toThrow()
  })
})

describe("escapeMarkdownInline", () => {
  it("escapes control characters and flattens newlines", () => {
    expect(escapeMarkdownInline("*a*\n_b_ `c`")).toBe("\\*a\\* \\_b\\_ \\`c\\`")
  })
})
