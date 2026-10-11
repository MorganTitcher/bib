import { describe, expect, it } from "vitest"
import { classifyReferrer } from "../src/referrer.ts"

describe("classifyReferrer", () => {
  it.each([
    ["https://www.google.com/", "search", "google"],
    ["https://www.google.co.uk/search?q=x", "search", "google"],
    ["https://google.de/", "search", "google"],
    ["https://google.com.br/", "search", "google"],
    ["https://www.bing.com/search?q=x", "search", "bing"],
    ["https://duckduckgo.com/", "search", "duckduckgo"],
    ["https://search.yahoo.com/", "search", "yahoo"],
    ["https://uk.search.yahoo.com/", "search", "yahoo"],
    ["https://chatgpt.com/", "search", "chatgpt"],
    ["https://t.co/abc", "social", "x"],
    ["https://l.facebook.com/l.php", "social", "facebook"],
    ["https://lm.facebook.com/", "social", "facebook"],
    ["https://old.reddit.com/r/x", "social", "reddit"],
    ["https://news.ycombinator.com/item?id=1", "social", "hacker_news"],
    ["https://mail.google.com/mail/u/0", "email", "gmail"],
    ["https://outlook.live.com/", "email", "outlook"],
  ])("%s is %s/%s", (ref, type, source) => {
    expect(classifyReferrer(ref)).toMatchObject({ type, source })
  })

  it("strips www and returns the host", () => {
    expect(classifyReferrer("https://www.google.co.uk/")).toEqual({
      type: "search",
      source: "google",
      host: "google.co.uk",
    })
  })

  it("never suffix-matches a lookalike", () => {
    expect(classifyReferrer("https://notgoogle.com/")).toMatchObject({ type: "referral" })
    expect(classifyReferrer("https://fakefacebook.com/")).toMatchObject({ type: "referral" })
    expect(classifyReferrer("https://google.com.evil.test/")).toMatchObject({ type: "referral" })
  })

  it("treats other Google subdomains as referrals", () => {
    expect(classifyReferrer("https://docs.google.com/document/d/1")).toEqual({
      type: "referral",
      source: "docs.google.com",
      host: "docs.google.com",
    })
  })

  it("is direct for empty, invalid or non-web referrers", () => {
    expect(classifyReferrer("")).toEqual({ type: "direct" })
    expect(classifyReferrer("   ")).toEqual({ type: "direct" })
    expect(classifyReferrer(null)).toEqual({ type: "direct" })
    expect(classifyReferrer(undefined)).toEqual({ type: "direct" })
    expect(classifyReferrer("not a url")).toEqual({ type: "direct" })
    expect(classifyReferrer("android-app://com.google.android.gm")).toEqual({ type: "direct" })
  })

  it("marks sign-in and payment hosts as transit", () => {
    expect(classifyReferrer("https://accounts.google.com/o/oauth2")).toMatchObject({
      type: "direct",
      transit: true,
    })
    expect(classifyReferrer("https://checkout.stripe.com/c/pay")).toMatchObject({ transit: true })
    expect(classifyReferrer("https://github.com/login/oauth")).toMatchObject({ transit: true })
    // Only github.com/login is transit; a repo link is a referral.
    expect(classifyReferrer("https://github.com/org/repo")).toMatchObject({ type: "referral" })
  })

  it("recognises same-site navigation including subdomains", () => {
    const opts = { siteHosts: ["www.example.com"] }
    expect(classifyReferrer("https://example.com/a", opts)).toEqual({
      type: "internal",
      host: "example.com",
    })
    expect(classifyReferrer("https://app.example.com/", opts).type).toBe("internal")
    expect(classifyReferrer("https://example.org/", opts).type).toBe("referral")
  })

  it("accepts custom host tables", () => {
    const r = classifyReferrer("https://forum.test/", { socialHosts: [["forum.test", "forum"]] })
    expect(r).toMatchObject({ type: "social", source: "forum" })
    // Replacing a table drops its defaults.
    expect(classifyReferrer("https://t.co/", { socialHosts: [] }).type).toBe("referral")
  })

  it("handles a trailing dot and uppercase host", () => {
    expect(classifyReferrer("https://WWW.BING.COM./")).toMatchObject({
      type: "search",
      host: "bing.com",
    })
  })
})
