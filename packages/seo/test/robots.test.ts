import { describe, expect, it } from "vitest"
import {
  AI_CRAWLERS,
  AI_CRAWLERS_REVIEWED,
  aiCrawlerTokens,
  aiPolicyGroups,
  buildRobotsTxt,
  disallowAllRobotsTxt,
} from "../src/robots.ts"

describe("AI crawler registry", () => {
  it("is dated, sourced and unique", () => {
    expect(AI_CRAWLERS_REVIEWED).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    const tokens = AI_CRAWLERS.map((c) => c.token.toLowerCase())
    expect(new Set(tokens).size).toBe(tokens.length)
    for (const c of AI_CRAWLERS) expect(c.source).toMatch(/^https:\/\//)
  })

  it("filters by purpose", () => {
    const training = aiCrawlerTokens("training")
    expect(training).toContain("GPTBot")
    expect(training).not.toContain("OAI-SearchBot")
  })
})

describe("aiPolicyGroups", () => {
  it("block-training allows search and blocks training", () => {
    const [allow, block, unverified] = aiPolicyGroups("block-training")
    expect(allow?.allow).toEqual(["/"])
    expect(block?.userAgent).toContain("ClaudeBot")
    expect(unverified?.userAgent).toContain("Bytespider")
  })

  it("can skip unverified tokens", () => {
    expect(aiPolicyGroups("block-all", false)).toHaveLength(1)
  })
})

describe("buildRobotsTxt", () => {
  it("defaults to allow-all for everyone", () => {
    expect(buildRobotsTxt()).toBe("User-agent: *\nAllow: /\n")
  })

  it("writes groups, policy, header and sitemaps", () => {
    const txt = buildRobotsTxt({
      header: ["robots for example.com"],
      groups: [{ userAgent: "*", disallow: ["/admin"], crawlDelay: 2 }],
      aiPolicy: "block-training",
      sitemaps: ["https://example.com/sitemap.xml"],
    })
    expect(
      txt.startsWith("# robots for example.com\n\nUser-agent: *\nDisallow: /admin\nCrawl-delay: 2"),
    ).toBe(true)
    expect(txt).toContain("User-agent: GPTBot")
    expect(txt.trimEnd().endsWith("Sitemap: https://example.com/sitemap.xml")).toBe(true)
  })

  it("removes tokens already claimed by a custom group from policy groups", () => {
    const txt = buildRobotsTxt({
      groups: [
        { userAgent: "*", allow: ["/"] },
        { userAgent: "gptbot", allow: ["/blog/"] },
      ],
      aiPolicy: "block-all",
    })
    expect(txt.match(/User-agent: gptbot/gi)).toHaveLength(1)
  })

  it("writes an empty Disallow for a group without rules", () => {
    expect(buildRobotsTxt({ groups: [{ userAgent: "Bot" }] })).toBe("User-agent: Bot\nDisallow:\n")
  })

  it("rejects duplicates, bad tokens, paths and sitemaps", () => {
    expect(() => buildRobotsTxt({ groups: [{ userAgent: "A" }, { userAgent: "a" }] })).toThrow(
      /more than one/,
    )
    expect(() => buildRobotsTxt({ groups: [{ userAgent: "Bad Bot" }] })).toThrow(/token/)
    expect(() => buildRobotsTxt({ groups: [{ userAgent: "*", disallow: ["admin"] }] })).toThrow(
      /start with/,
    )
    expect(() => buildRobotsTxt({ groups: [{ userAgent: "*", disallow: ["/a #b"] }] })).toThrow()
    expect(() => buildRobotsTxt({ groups: [{ userAgent: [] }] })).toThrow(/at least one/)
    expect(() => buildRobotsTxt({ sitemaps: ["/sitemap.xml"] })).toThrow(/absolute/)
    expect(() => buildRobotsTxt({ groups: [{ userAgent: "*", crawlDelay: -1 }] })).toThrow()
  })

  it("comments cannot inject directives across lines", () => {
    const txt = buildRobotsTxt({ groups: [{ userAgent: "*", comment: "x\nDisallow: /" }] })
    expect(txt).toContain("# Disallow: /")
    expect(txt).not.toMatch(/^Disallow: \/$/m)
  })

  it("has a staging variant", () => {
    expect(disallowAllRobotsTxt()).toBe("User-agent: *\nDisallow: /\n")
  })
})
