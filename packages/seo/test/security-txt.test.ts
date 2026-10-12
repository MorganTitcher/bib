import { describe, expect, it } from "vitest"
import { buildSecurityTxt } from "../src/security-txt.ts"

const NOW = new Date("2026-10-11T00:00:00Z")

describe("buildSecurityTxt", () => {
  it("writes fields in order with a mailto contact", () => {
    const out = buildSecurityTxt(
      {
        contact: ["security@example.com", "https://example.com/report"],
        expires: "2027-04-01T00:00:00Z",
        policy: ["https://example.com/policy"],
        preferredLanguages: ["en", "de"],
        canonical: ["https://example.com/.well-known/security.txt"],
        comments: ["Thanks"],
      },
      NOW,
    )
    expect(out.path).toBe("/.well-known/security.txt")
    expect(out.body).toBe(
      "# Thanks\nContact: mailto:security@example.com\nContact: https://example.com/report\nExpires: 2027-04-01T00:00:00.000Z\nPreferred-Languages: en, de\nCanonical: https://example.com/.well-known/security.txt\nPolicy: https://example.com/policy\n",
    )
    expect(out.warnings).toEqual([])
  })

  it("warns on a far expiry and an odd canonical", () => {
    const out = buildSecurityTxt(
      {
        contact: ["mailto:a@example.com"],
        expires: "2028-01-01",
        canonical: ["https://example.com/security.txt"],
      },
      NOW,
    )
    expect(out.warnings).toHaveLength(2)
  })

  it("rejects missing contact, past expiry, bad schemes and line breaks", () => {
    expect(() => buildSecurityTxt({ contact: [], expires: "2027-01-01" }, NOW)).toThrow()
    expect(() =>
      buildSecurityTxt({ contact: ["a@example.com"], expires: "2026-01-01" }, NOW),
    ).toThrow()
    expect(() => buildSecurityTxt({ contact: ["ftp://x"], expires: "2027-01-01" }, NOW)).toThrow()
    expect(() =>
      buildSecurityTxt({ contact: ["https://e.com/\nExpires: x"], expires: "2027-01-01" }, NOW),
    ).toThrow()
    expect(() =>
      buildSecurityTxt(
        { contact: ["a@example.com"], expires: "2027-01-01", policy: ["http://example.com"] },
        NOW,
      ),
    ).toThrow()
    expect(() =>
      buildSecurityTxt(
        { contact: ["a@example.com"], expires: "2027-01-01", preferredLanguages: ["en us"] },
        NOW,
      ),
    ).toThrow()
  })
})
