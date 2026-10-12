import { describe, expect, it } from "vitest"
import {
  article,
  blogPosting,
  breadcrumbList,
  event,
  faqPage,
  graph,
  howTo,
  jsonLdScriptTag,
  localBusiness,
  offer,
  organization,
  product,
  ref,
  serializeJsonLd,
  softwareApplication,
  webPage,
  webSite,
} from "../src/jsonld.ts"

const ORG = "https://example.com/#organization"

describe("serializeJsonLd", () => {
  it("escapes characters that could break out of a script element", () => {
    const out = serializeJsonLd({
      "@type": "Thing",
      name: "</script><script>alert(1)</script> & <!-- \u2028\u2029",
    })
    expect(out).not.toContain("</script")
    expect(out).not.toContain("<!--")
    expect(out).not.toContain("\u2028")
    expect(out).not.toContain("\u2029")
    expect(out).toContain("\\u003c/script\\u003e")
    expect(out).toContain("\\u0026")
    expect(out).toContain("\\u2028\\u2029")
  })

  it("round-trips to the same value", () => {
    const value = { "@type": "Thing", name: "a<b>&c\u2028d" }
    expect(JSON.parse(serializeJsonLd(value))).toEqual(value)
  })

  it("wraps in a script tag and sanitizes the nonce", () => {
    const tag = jsonLdScriptTag({ "@type": "Thing" }, { nonce: 'abc"><x' })
    expect(tag).toBe('<script type="application/ld+json" nonce="abcx">{"@type":"Thing"}</script>')
  })
})

describe("organization / webSite / webPage", () => {
  it("builds an organization with @context and drops undefined fields", () => {
    const org = organization({
      name: "Example",
      url: "https://example.com",
      id: ORG,
      sameAs: ["https://x.example/ex"],
    })
    expect(org["@context"]).toBe("https://schema.org")
    expect(org["@type"]).toBe("Organization")
    expect(org["@id"]).toBe(ORG)
    expect("email" in org).toBe(false)
  })

  it("rejects relative URLs", () => {
    expect(() => organization({ name: "Example", url: "/about" })).toThrow(RangeError)
  })

  it("adds a SearchAction only with a valid template", () => {
    const site = webSite({
      name: "Ex",
      url: "https://example.com",
      searchUrlTemplate: "https://example.com/s?q={search_term_string}",
      publisher: ref(ORG),
    })
    expect(site.potentialAction).toMatchObject({ "@type": "SearchAction" })
    expect(site.publisher).toEqual({ "@id": ORG })
    expect(() =>
      webSite({
        name: "Ex",
        url: "https://example.com",
        searchUrlTemplate: "https://example.com/s?q=",
      }),
    ).toThrow(/search_term_string/)
  })

  it("defaults dateModified to datePublished and rejects time travel", () => {
    const page = webPage({ name: "Home", url: "https://example.com/", datePublished: "2026-01-02" })
    expect(page.dateModified).toBe("2026-01-02")
    expect(() =>
      webPage({
        name: "Home",
        url: "https://example.com/",
        datePublished: "2026-02-01",
        dateModified: "2026-01-01",
      }),
    ).toThrow(/precede/)
  })

  it("rejects impossible dates", () => {
    expect(() =>
      webPage({ name: "Home", url: "https://example.com/", datePublished: "2026-02-31" }),
    ).toThrow(/invalid date/)
  })
})

describe("article", () => {
  const base = {
    headline: "Hello",
    url: "https://example.com/blog/hello",
    datePublished: "2026-03-01",
    author: { name: "Ada" },
  }

  it("builds a BlogPosting with mainEntityOfPage and joined keywords", () => {
    const post = blogPosting({ ...base, keywords: ["a", "b"], publisher: ref(ORG) })
    expect(post["@type"]).toBe("BlogPosting")
    expect(post.mainEntityOfPage).toEqual({ "@type": "WebPage", "@id": base.url })
    expect(post.keywords).toBe("a, b")
    expect(post.author).toEqual({ "@type": "Person", name: "Ada" })
  })

  it("enforces headline limits and authors", () => {
    expect(() => article({ ...base, headline: " " })).toThrow()
    expect(() => article({ ...base, headline: "x".repeat(111) })).toThrow(/110/)
    expect(() => article({ ...base, author: [] })).toThrow(/author/)
  })
})

describe("offer / product / software", () => {
  it("validates price and currency", () => {
    expect(offer({ price: 0, priceCurrency: "USD", availability: "InStock" })).toMatchObject({
      price: "0",
      availability: "https://schema.org/InStock",
    })
    expect(() => offer({ price: "-1", priceCurrency: "USD" })).toThrow()
    expect(() => offer({ price: "1,00", priceCurrency: "USD" })).toThrow()
    expect(() => offer({ price: 1, priceCurrency: "usd" })).toThrow(/4217/)
  })

  it("nests offers without their own @context", () => {
    const p = product({ name: "Widget", offers: [{ price: "9.99", priceCurrency: "EUR" }] })
    expect(p.offers).toEqual({ "@type": "Offer", price: "9.99", priceCurrency: "EUR" })
  })

  it("validates aggregate ratings", () => {
    expect(() =>
      softwareApplication({
        name: "App",
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web",
        aggregateRating: { ratingValue: 4, ratingCount: 0 },
      }),
    ).toThrow()
    expect(() =>
      product({ name: "W", aggregateRating: { ratingValue: 6, ratingCount: 3 } }),
    ).toThrow()
    const app = softwareApplication({
      name: "App",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      aggregateRating: { ratingValue: 4.5, ratingCount: 12 },
    })
    expect(app.aggregateRating).toMatchObject({ "@type": "AggregateRating", ratingCount: 12 })
  })
})

describe("faq / breadcrumbs / howTo", () => {
  it("builds FAQ and rejects blanks", () => {
    const faq = faqPage([{ question: "Q?", answer: "A." }])
    expect(faq.mainEntity).toEqual([
      { "@type": "Question", name: "Q?", acceptedAnswer: { "@type": "Answer", text: "A." } },
    ])
    expect(() => faqPage([])).toThrow()
    expect(() => faqPage([{ question: "Q", answer: " " }])).toThrow(/blank/)
  })

  it("numbers breadcrumbs and lets only the last omit url", () => {
    const list = breadcrumbList([{ name: "Home", url: "https://example.com/" }, { name: "Here" }])
    expect(list.itemListElement).toEqual([
      { "@type": "ListItem", position: 1, name: "Home", item: "https://example.com/" },
      { "@type": "ListItem", position: 2, name: "Here" },
    ])
    expect(() => breadcrumbList([{ name: "Home" }, { name: "Here" }])).toThrow(/last item/)
  })

  it("validates howTo duration and steps", () => {
    const h = howTo({
      name: "Tea",
      steps: ["Boil", { text: "Steep", name: "Wait" }],
      totalTime: "PT5M",
    })
    expect((h.step as unknown[]).length).toBe(2)
    expect(() => howTo({ name: "Tea", steps: [] })).toThrow()
    expect(() => howTo({ name: "Tea", steps: ["x"], totalTime: "5 minutes" })).toThrow(/ISO 8601/)
    expect(() => howTo({ name: "Tea", steps: ["x"], totalTime: "P" })).toThrow()
  })
})

describe("event / localBusiness", () => {
  const place = {
    name: "Hall",
    address: { streetAddress: "1 Main St", addressLocality: "Town", addressCountry: "US" },
  }

  it("infers attendance mode and builds locations", () => {
    const online = event({
      name: "Talk",
      startDate: "2026-11-01T18:00:00Z",
      onlineUrl: "https://example.com/live",
    })
    expect(online.eventAttendanceMode).toBe("https://schema.org/OnlineEventAttendanceMode")
    const mixed = event({
      name: "Talk",
      startDate: "2026-11-01",
      attendanceMode: "Mixed",
      place,
      onlineUrl: "https://example.com/live",
    })
    expect((mixed.location as unknown[]).length).toBe(2)
  })

  it("rejects missing locations and reversed dates", () => {
    expect(() => event({ name: "Talk", startDate: "2026-11-01" })).toThrow(/place/)
    expect(() =>
      event({ name: "Talk", startDate: "2026-11-01", attendanceMode: "Mixed", place }),
    ).toThrow(/onlineUrl/)
    expect(() =>
      event({ name: "Talk", startDate: "2026-11-02", endDate: "2026-11-01", place }),
    ).toThrow(/precede/)
  })

  it("validates geo and hours", () => {
    const biz = localBusiness({
      name: "Cafe",
      type: "CafeOrCoffeeShop",
      address: place.address,
      geo: { latitude: 1, longitude: 2 },
      openingHours: [{ days: ["Monday"], opens: "08:00", closes: "17:30" }],
    })
    expect(biz["@type"]).toBe("CafeOrCoffeeShop")
    expect(() =>
      localBusiness({ name: "C", address: place.address, geo: { latitude: 91, longitude: 0 } }),
    ).toThrow(/geo/)
    expect(() =>
      localBusiness({
        name: "C",
        address: place.address,
        openingHours: [{ days: ["Monday"], opens: "8am", closes: "17:00" }],
      }),
    ).toThrow(/HH:MM/)
    expect(() =>
      localBusiness({
        name: "C",
        address: place.address,
        openingHours: [{ days: [], opens: "08:00", closes: "17:00" }],
      }),
    ).toThrow(/days/)
  })
})

describe("graph", () => {
  it("strips nested @context", () => {
    const g = graph([
      organization({ name: "Ex", url: "https://example.com", id: ORG }),
      webSite({ name: "Ex", url: "https://example.com" }),
    ])
    expect(g["@context"]).toBe("https://schema.org")
    const nodes = g["@graph"] as Record<string, unknown>[]
    expect(nodes.every((n) => !("@context" in n))).toBe(true)
  })
})
