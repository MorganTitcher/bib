/**
 * Typed schema.org JSON-LD builders and safe `<script>` serialization.
 *
 * Every builder returns a plain object (`JsonLdObject`) with `@context` and
 * `@type`, drops `undefined` fields and empty arrays, and normalizes dates.
 * Builders never invent data: ratings, prices and reviews appear only when you
 * pass them, because structured data must mirror what the page actually shows.
 *
 * Use stable `@id` anchors (`https://example.com/#organization`) so pages can
 * reference the same entity with `{ "@id": … }` instead of repeating it, and
 * combine several entities on one page with {@link graph}.
 */

import { compact, type DateInput, requireAbsoluteUrl, requireDate } from "./internal.ts"

/** A JSON value that can appear inside JSON-LD. */
export type JsonLdValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonLdValue[]
  | { readonly [key: string]: JsonLdValue | undefined }

/** A JSON-LD node. */
export type JsonLdObject = { readonly [key: string]: JsonLdValue | undefined }

/** Reference to an entity defined elsewhere by `@id`. */
export interface JsonLdRef {
  readonly "@id": string
}

const CONTEXT = "https://schema.org"

/** `{ "@id": id }` — reference an entity by its stable anchor. */
export function ref(id: string): JsonLdRef {
  return { "@id": id }
}

function node(type: string | readonly string[], fields: Record<string, unknown>): JsonLdObject {
  return compact({ "@context": CONTEXT, "@type": type, ...fields }) as JsonLdObject
}

/** Strip `@context` from a node so it can be nested or placed in a graph. */
function bare(value: JsonLdObject): JsonLdObject {
  const { "@context": _context, ...rest } = value
  return rest
}

function optDate(input: DateInput | undefined, field: string): string | undefined {
  return input === undefined ? undefined : requireDate(input, field)
}

function optUrl(url: string | undefined, field: string): string | undefined {
  return url === undefined ? undefined : requireAbsoluteUrl(url, field)
}

// ---------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------

export interface ImageInput {
  readonly url: string
  readonly width?: number
  readonly height?: number
  readonly caption?: string
}

function image(input: string | ImageInput | undefined): JsonLdValue | undefined {
  if (input === undefined) return undefined
  if (typeof input === "string") return requireAbsoluteUrl(input, "image")
  return compact({
    "@type": "ImageObject",
    url: requireAbsoluteUrl(input.url, "image.url"),
    width: input.width,
    height: input.height,
    caption: input.caption,
  }) as JsonLdObject
}

function images(
  input: string | ImageInput | readonly (string | ImageInput)[] | undefined,
): JsonLdValue | undefined {
  if (input === undefined) return undefined
  if (Array.isArray(input)) {
    const list = (input as readonly (string | ImageInput)[]).map((i) => image(i) as JsonLdValue)
    return list.length === 0 ? undefined : list
  }
  return image(input as string | ImageInput)
}

export interface PersonInput {
  readonly name: string
  readonly url?: string
}

/** An author or publisher: a person, an organization, or a reference to one. */
export type PartyInput = PersonInput | JsonLdRef | JsonLdObject

function party(input: PartyInput, defaultType: "Person" | "Organization"): JsonLdValue {
  if ("@id" in input || "@type" in input) {
    return "@context" in input ? bare(input as JsonLdObject) : (input as JsonLdObject)
  }
  const p = input as PersonInput
  return compact({ "@type": defaultType, name: p.name, url: optUrl(p.url, "url") }) as JsonLdObject
}

export interface PostalAddressInput {
  readonly streetAddress?: string
  readonly addressLocality?: string
  readonly addressRegion?: string
  readonly postalCode?: string
  /** ISO 3166-1 alpha-2 code, e.g. `US`. */
  readonly addressCountry?: string
}

function address(input: PostalAddressInput | undefined): JsonLdValue | undefined {
  if (input === undefined) return undefined
  return compact({ "@type": "PostalAddress", ...input }) as JsonLdObject
}

export interface RatingInput {
  /** Average rating shown on the page. */
  readonly ratingValue: number
  /** Number of ratings that produced the average. Must be ≥ 1. */
  readonly ratingCount: number
  readonly bestRating?: number
  readonly worstRating?: number
}

function rating(input: RatingInput | undefined): JsonLdValue | undefined {
  if (input === undefined) return undefined
  if (!Number.isInteger(input.ratingCount) || input.ratingCount < 1) {
    throw new RangeError("aggregateRating.ratingCount must be a positive integer")
  }
  const best = input.bestRating ?? 5
  const worst = input.worstRating ?? 1
  if (input.ratingValue < worst || input.ratingValue > best) {
    throw new RangeError(`aggregateRating.ratingValue must be within [${worst}, ${best}]`)
  }
  return compact({
    "@type": "AggregateRating",
    ratingValue: input.ratingValue,
    ratingCount: input.ratingCount,
    bestRating: input.bestRating,
    worstRating: input.worstRating,
  }) as JsonLdObject
}

// ---------------------------------------------------------------------------
// Organization, WebSite, WebPage
// ---------------------------------------------------------------------------

export interface OrganizationInput {
  readonly name: string
  readonly url: string
  /** Stable anchor, e.g. `https://example.com/#organization`. */
  readonly id?: string
  readonly logo?: string | ImageInput
  readonly description?: string
  /** Official profiles (social, directories) — `sameAs`. */
  readonly sameAs?: readonly string[]
  readonly email?: string
  readonly telephone?: string
  readonly address?: PostalAddressInput
  readonly foundingDate?: DateInput
  readonly legalName?: string
}

/** schema.org `Organization`. */
export function organization(input: OrganizationInput): JsonLdObject {
  return node("Organization", {
    "@id": input.id,
    name: input.name,
    legalName: input.legalName,
    url: requireAbsoluteUrl(input.url, "url"),
    logo: image(input.logo),
    description: input.description,
    sameAs: input.sameAs?.map((u) => requireAbsoluteUrl(u, "sameAs")),
    email: input.email,
    telephone: input.telephone,
    address: address(input.address),
    foundingDate: optDate(input.foundingDate, "foundingDate"),
  })
}

export interface WebSiteInput {
  readonly name: string
  readonly url: string
  readonly id?: string
  readonly description?: string
  readonly inLanguage?: string
  readonly publisher?: PartyInput
  /**
   * Site-search URL template containing `{search_term_string}`, e.g.
   * `https://example.com/search?q={search_term_string}`. Adds a `SearchAction`.
   */
  readonly searchUrlTemplate?: string
}

/** schema.org `WebSite`, optionally with a sitelinks-search `SearchAction`. */
export function webSite(input: WebSiteInput): JsonLdObject {
  let potentialAction: JsonLdObject | undefined
  if (input.searchUrlTemplate !== undefined) {
    if (!input.searchUrlTemplate.includes("{search_term_string}")) {
      throw new RangeError("searchUrlTemplate must contain {search_term_string}")
    }
    potentialAction = {
      "@type": "SearchAction",
      target: { "@type": "EntryPoint", urlTemplate: input.searchUrlTemplate },
      "query-input": "required name=search_term_string",
    }
  }
  return node("WebSite", {
    "@id": input.id,
    name: input.name,
    url: requireAbsoluteUrl(input.url, "url"),
    description: input.description,
    inLanguage: input.inLanguage,
    publisher: input.publisher === undefined ? undefined : party(input.publisher, "Organization"),
    potentialAction,
  })
}

export interface WebPageInput {
  readonly name: string
  readonly url: string
  readonly id?: string
  readonly description?: string
  readonly inLanguage?: string
  /** Defaults to `WebPage`; use `AboutPage`, `ContactPage`, `CollectionPage`, `FAQPage`… */
  readonly type?: string
  readonly isPartOf?: JsonLdRef
  readonly datePublished?: DateInput
  readonly dateModified?: DateInput
  readonly primaryImage?: string | ImageInput
  readonly breadcrumb?: JsonLdRef
}

/** schema.org `WebPage` (or a subtype via `type`). */
export function webPage(input: WebPageInput): JsonLdObject {
  const { datePublished, dateModified } = freshness(input.datePublished, input.dateModified)
  return node(input.type ?? "WebPage", {
    "@id": input.id,
    name: input.name,
    url: requireAbsoluteUrl(input.url, "url"),
    description: input.description,
    inLanguage: input.inLanguage,
    isPartOf: input.isPartOf,
    datePublished,
    dateModified,
    primaryImageOfPage: image(input.primaryImage),
    breadcrumb: input.breadcrumb,
  })
}

/**
 * Normalize a published/modified pair. `dateModified` defaults to
 * `datePublished` and may never precede it (a modified date earlier than the
 * publish date is a data error and throws).
 */
function freshness(
  published: DateInput | undefined,
  modified: DateInput | undefined,
): { datePublished?: string; dateModified?: string } {
  const datePublished = optDate(published, "datePublished")
  const dateModified = optDate(modified, "dateModified") ?? datePublished
  if (datePublished !== undefined && dateModified !== undefined) {
    if (Date.parse(dateModified) < Date.parse(datePublished)) {
      throw new RangeError("dateModified must not precede datePublished")
    }
  }
  return compact({ datePublished, dateModified }) as {
    datePublished?: string
    dateModified?: string
  }
}

// ---------------------------------------------------------------------------
// Article / BlogPosting
// ---------------------------------------------------------------------------

export interface ArticleInput {
  readonly headline: string
  readonly url: string
  readonly datePublished: DateInput
  readonly dateModified?: DateInput
  readonly author: PartyInput | readonly PartyInput[]
  readonly publisher?: PartyInput
  readonly image?: string | ImageInput | readonly (string | ImageInput)[]
  readonly description?: string
  readonly id?: string
  /** `Article` (default), `BlogPosting`, `NewsArticle`, `TechArticle`. */
  readonly type?: "Article" | "BlogPosting" | "NewsArticle" | "TechArticle"
  readonly keywords?: readonly string[]
  readonly articleSection?: string
  readonly wordCount?: number
  readonly inLanguage?: string
}

/** schema.org `Article` and its subtypes. Headlines over 110 characters throw. */
export function article(input: ArticleInput): JsonLdObject {
  if (input.headline.trim() === "") throw new RangeError("headline must not be empty")
  if (input.headline.length > 110) {
    throw new RangeError("headline must be at most 110 characters (Google's Article limit)")
  }
  const url = requireAbsoluteUrl(input.url, "url")
  const authors = (Array.isArray(input.author) ? input.author : [input.author]) as PartyInput[]
  if (authors.length === 0) throw new RangeError("article requires at least one author")
  const { datePublished, dateModified } = freshness(input.datePublished, input.dateModified)
  return node(input.type ?? "Article", {
    "@id": input.id,
    headline: input.headline,
    description: input.description,
    url,
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    datePublished,
    dateModified,
    author:
      authors.length === 1
        ? party(authors[0] as PartyInput, "Person")
        : authors.map((a) => party(a, "Person")),
    publisher: input.publisher === undefined ? undefined : party(input.publisher, "Organization"),
    image: images(input.image),
    keywords: input.keywords?.length ? input.keywords.join(", ") : undefined,
    articleSection: input.articleSection,
    wordCount: input.wordCount,
    inLanguage: input.inLanguage,
  })
}

/** Shorthand for {@link article} with `type: "BlogPosting"`. */
export function blogPosting(input: Omit<ArticleInput, "type">): JsonLdObject {
  return article({ ...input, type: "BlogPosting" })
}

// ---------------------------------------------------------------------------
// Product / Offer, SoftwareApplication
// ---------------------------------------------------------------------------

export type Availability =
  | "InStock"
  | "OutOfStock"
  | "PreOrder"
  | "BackOrder"
  | "Discontinued"
  | "LimitedAvailability"
  | "OnlineOnly"
  | "SoldOut"

export interface OfferInput {
  /** Decimal string or number, e.g. `"19.99"`. Zero is allowed (free). */
  readonly price: string | number
  /** ISO 4217, e.g. `USD`. */
  readonly priceCurrency: string
  readonly availability?: Availability
  readonly url?: string
  readonly priceValidUntil?: DateInput
  readonly name?: string
}

const CURRENCY = /^[A-Z]{3}$/

/** schema.org `Offer`. Price must be a non-negative decimal; currency ISO 4217. */
export function offer(input: OfferInput): JsonLdObject {
  const price = typeof input.price === "number" ? String(input.price) : input.price.trim()
  if (!/^\d+(\.\d+)?$/.test(price))
    throw new RangeError(`offer.price must be a non-negative decimal, got ${input.price}`)
  if (!CURRENCY.test(input.priceCurrency)) {
    throw new RangeError(`offer.priceCurrency must be an ISO 4217 code, got ${input.priceCurrency}`)
  }
  return bare(
    node("Offer", {
      name: input.name,
      price,
      priceCurrency: input.priceCurrency,
      availability:
        input.availability === undefined ? undefined : `${CONTEXT}/${input.availability}`,
      url: optUrl(input.url, "offer.url"),
      priceValidUntil: optDate(input.priceValidUntil, "offer.priceValidUntil"),
    }),
  )
}

export interface ProductInput {
  readonly name: string
  readonly description?: string
  readonly url?: string
  readonly id?: string
  readonly image?: string | ImageInput | readonly (string | ImageInput)[]
  readonly sku?: string
  readonly gtin?: string
  readonly brand?: string
  readonly offers?: OfferInput | readonly OfferInput[]
  readonly aggregateRating?: RatingInput
}

/** schema.org `Product` with optional `Offer`s and a real `AggregateRating`. */
export function product(input: ProductInput): JsonLdObject {
  return node("Product", {
    "@id": input.id,
    name: input.name,
    description: input.description,
    url: optUrl(input.url, "url"),
    image: images(input.image),
    sku: input.sku,
    gtin: input.gtin,
    brand: input.brand === undefined ? undefined : { "@type": "Brand", name: input.brand },
    offers: offers(input.offers),
    aggregateRating: rating(input.aggregateRating),
  })
}

function offers(input: OfferInput | readonly OfferInput[] | undefined): JsonLdValue | undefined {
  if (input === undefined) return undefined
  if (Array.isArray(input)) {
    const list = (input as readonly OfferInput[]).map(offer)
    return list.length === 0 ? undefined : list.length === 1 ? list[0] : list
  }
  return offer(input as OfferInput)
}

export interface SoftwareApplicationInput {
  readonly name: string
  /** e.g. `BusinessApplication`, `DeveloperApplication`, `GameApplication`. */
  readonly applicationCategory: string
  /** e.g. `Web`, `Windows, macOS`, `Android`. */
  readonly operatingSystem: string
  readonly url?: string
  readonly id?: string
  readonly description?: string
  readonly softwareVersion?: string
  readonly offers?: OfferInput | readonly OfferInput[]
  readonly aggregateRating?: RatingInput
  readonly image?: string | ImageInput
  /** Defaults to `SoftwareApplication`; `WebApplication` and `MobileApplication` are subtypes. */
  readonly type?: "SoftwareApplication" | "WebApplication" | "MobileApplication"
}

/** schema.org `SoftwareApplication`. */
export function softwareApplication(input: SoftwareApplicationInput): JsonLdObject {
  return node(input.type ?? "SoftwareApplication", {
    "@id": input.id,
    name: input.name,
    description: input.description,
    url: optUrl(input.url, "url"),
    applicationCategory: input.applicationCategory,
    operatingSystem: input.operatingSystem,
    softwareVersion: input.softwareVersion,
    image: image(input.image),
    offers: offers(input.offers),
    aggregateRating: rating(input.aggregateRating),
  })
}

// ---------------------------------------------------------------------------
// FAQPage, BreadcrumbList, HowTo
// ---------------------------------------------------------------------------

export interface FaqItem {
  readonly question: string
  /** Plain text or limited HTML; it must match the answer visible on the page. */
  readonly answer: string
}

/** schema.org `FAQPage`. Throws on an empty list or blank Q/A. */
export function faqPage(
  items: readonly FaqItem[],
  options: { readonly url?: string; readonly id?: string } = {},
): JsonLdObject {
  if (items.length === 0) throw new RangeError("faqPage requires at least one item")
  return node("FAQPage", {
    "@id": options.id,
    url: optUrl(options.url, "url"),
    mainEntity: items.map((item, i) => {
      if (item.question.trim() === "" || item.answer.trim() === "") {
        throw new RangeError(`faqPage item ${i}: question and answer must not be blank`)
      }
      return {
        "@type": "Question",
        name: item.question,
        acceptedAnswer: { "@type": "Answer", text: item.answer },
      }
    }),
  })
}

export interface BreadcrumbItem {
  readonly name: string
  /** Absolute URL. Optional only for the last item (the current page). */
  readonly url?: string
}

/** schema.org `BreadcrumbList` with 1-based positions. */
export function breadcrumbList(
  items: readonly BreadcrumbItem[],
  options: { readonly id?: string } = {},
): JsonLdObject {
  if (items.length === 0) throw new RangeError("breadcrumbList requires at least one item")
  return node("BreadcrumbList", {
    "@id": options.id,
    itemListElement: items.map((item, i) => {
      const last = i === items.length - 1
      if (item.url === undefined && !last) {
        throw new RangeError(`breadcrumbList item ${i}: only the last item may omit url`)
      }
      return compact({
        "@type": "ListItem",
        position: i + 1,
        name: item.name,
        item: optUrl(item.url, `breadcrumbList item ${i}`),
      })
    }),
  })
}

export interface HowToStepInput {
  readonly text: string
  readonly name?: string
  readonly url?: string
  readonly image?: string
}

export interface HowToInput {
  readonly name: string
  readonly steps: readonly (string | HowToStepInput)[]
  readonly description?: string
  /** ISO 8601 duration, e.g. `PT30M`. */
  readonly totalTime?: string
  readonly supply?: readonly string[]
  readonly tool?: readonly string[]
  readonly image?: string | ImageInput
  readonly estimatedCost?: { readonly value: string | number; readonly currency: string }
}

const ISO_DURATION = /^P(?!$)(\d+Y)?(\d+M)?(\d+W)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+(\.\d+)?S)?)?$/

/** schema.org `HowTo`. Step positions are 1-based; `totalTime` must be ISO 8601. */
export function howTo(input: HowToInput): JsonLdObject {
  if (input.steps.length === 0) throw new RangeError("howTo requires at least one step")
  if (input.totalTime !== undefined && !ISO_DURATION.test(input.totalTime)) {
    throw new RangeError(`howTo.totalTime must be an ISO 8601 duration, got ${input.totalTime}`)
  }
  return node("HowTo", {
    name: input.name,
    description: input.description,
    totalTime: input.totalTime,
    image: image(input.image),
    estimatedCost:
      input.estimatedCost === undefined
        ? undefined
        : {
            "@type": "MonetaryAmount",
            currency: input.estimatedCost.currency,
            value: String(input.estimatedCost.value),
          },
    supply: input.supply?.map((name) => ({ "@type": "HowToSupply", name })),
    tool: input.tool?.map((name) => ({ "@type": "HowToTool", name })),
    step: input.steps.map((s, i) => {
      const step = typeof s === "string" ? { text: s } : s
      if (step.text.trim() === "") throw new RangeError(`howTo step ${i}: text must not be blank`)
      return compact({
        "@type": "HowToStep",
        position: i + 1,
        name: step.name,
        text: step.text,
        url: optUrl(step.url, `howTo step ${i}.url`),
        image: optUrl(step.image, `howTo step ${i}.image`),
      })
    }),
  })
}

// ---------------------------------------------------------------------------
// Event, LocalBusiness
// ---------------------------------------------------------------------------

export type EventAttendanceMode = "Offline" | "Online" | "Mixed"
export type EventStatus =
  | "EventScheduled"
  | "EventCancelled"
  | "EventPostponed"
  | "EventRescheduled"
  | "EventMovedOnline"

export interface EventInput {
  readonly name: string
  readonly startDate: DateInput
  readonly endDate?: DateInput
  readonly description?: string
  readonly url?: string
  readonly image?: string | ImageInput
  readonly attendanceMode?: EventAttendanceMode
  readonly status?: EventStatus
  /** Physical venue (required for Offline/Mixed). */
  readonly place?: { readonly name: string; readonly address: PostalAddressInput }
  /** Online URL (required for Online/Mixed). */
  readonly onlineUrl?: string
  readonly organizer?: PartyInput
  readonly offers?: OfferInput | readonly OfferInput[]
}

/** schema.org `Event`. Validates the location against the attendance mode and end ≥ start. */
export function event(input: EventInput): JsonLdObject {
  const mode =
    input.attendanceMode ??
    (input.onlineUrl !== undefined && input.place === undefined ? "Online" : "Offline")
  const needsPlace = mode !== "Online"
  const needsUrl = mode !== "Offline"
  if (needsPlace && input.place === undefined)
    throw new RangeError(`event with ${mode} attendance requires place`)
  if (needsUrl && input.onlineUrl === undefined)
    throw new RangeError(`event with ${mode} attendance requires onlineUrl`)
  const startDate = requireDate(input.startDate, "startDate")
  const endDate = optDate(input.endDate, "endDate")
  if (endDate !== undefined && Date.parse(endDate) < Date.parse(startDate)) {
    throw new RangeError("endDate must not precede startDate")
  }
  const locations: JsonLdObject[] = []
  if (needsPlace && input.place) {
    locations.push({
      "@type": "Place",
      name: input.place.name,
      address: address(input.place.address),
    })
  }
  if (needsUrl && input.onlineUrl) {
    locations.push({
      "@type": "VirtualLocation",
      url: requireAbsoluteUrl(input.onlineUrl, "onlineUrl"),
    })
  }
  return node("Event", {
    name: input.name,
    description: input.description,
    url: optUrl(input.url, "url"),
    image: image(input.image),
    startDate,
    endDate,
    eventAttendanceMode: `${CONTEXT}/${mode}EventAttendanceMode`,
    eventStatus: `${CONTEXT}/${input.status ?? "EventScheduled"}`,
    location: locations.length === 1 ? locations[0] : locations,
    organizer: input.organizer === undefined ? undefined : party(input.organizer, "Organization"),
    offers: offers(input.offers),
  })
}

export type DayOfWeek =
  | "Monday"
  | "Tuesday"
  | "Wednesday"
  | "Thursday"
  | "Friday"
  | "Saturday"
  | "Sunday"

export interface OpeningHoursInput {
  readonly days: readonly DayOfWeek[]
  /** `HH:MM`, 24-hour. */
  readonly opens: string
  readonly closes: string
}

export interface LocalBusinessInput {
  readonly name: string
  readonly address: PostalAddressInput
  readonly url?: string
  readonly id?: string
  /** Defaults to `LocalBusiness`; any subtype such as `Restaurant`, `Dentist`, `Store`. */
  readonly type?: string
  readonly telephone?: string
  readonly image?: string | ImageInput
  readonly priceRange?: string
  readonly geo?: { readonly latitude: number; readonly longitude: number }
  readonly openingHours?: readonly OpeningHoursInput[]
  readonly sameAs?: readonly string[]
  readonly aggregateRating?: RatingInput
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

/** schema.org `LocalBusiness` (or a subtype). Validates coordinates and `HH:MM` hours. */
export function localBusiness(input: LocalBusinessInput): JsonLdObject {
  if (input.geo !== undefined) {
    const { latitude, longitude } = input.geo
    if (!(Math.abs(latitude) <= 90) || !(Math.abs(longitude) <= 180)) {
      throw new RangeError("geo coordinates out of range")
    }
  }
  return node(input.type ?? "LocalBusiness", {
    "@id": input.id,
    name: input.name,
    url: optUrl(input.url, "url"),
    image: image(input.image),
    telephone: input.telephone,
    priceRange: input.priceRange,
    address: address(input.address),
    geo: input.geo === undefined ? undefined : { "@type": "GeoCoordinates", ...input.geo },
    openingHoursSpecification: input.openingHours?.map((h, i) => {
      if (!HHMM.test(h.opens) || !HHMM.test(h.closes)) {
        throw new RangeError(`openingHours ${i}: opens/closes must be HH:MM`)
      }
      if (h.days.length === 0) throw new RangeError(`openingHours ${i}: days must not be empty`)
      return {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: [...h.days],
        opens: h.opens,
        closes: h.closes,
      }
    }),
    sameAs: input.sameAs?.map((u) => requireAbsoluteUrl(u, "sameAs")),
    aggregateRating: rating(input.aggregateRating),
  })
}

// ---------------------------------------------------------------------------
// Graph and serialization
// ---------------------------------------------------------------------------

/** Combine nodes into one `@graph` document (nested `@context`s are removed). */
export function graph(nodes: readonly JsonLdObject[]): JsonLdObject {
  return { "@context": CONTEXT, "@graph": nodes.map(bare) }
}

const SCRIPT_UNSAFE: Readonly<Record<string, string>> = {
  "<": "\\u003c",
  ">": "\\u003e",
  "&": "\\u0026",
  "\u2028": "\\u2028",
  "\u2029": "\\u2029",
}

/**
 * Serialize JSON-LD so it is safe inside `<script type="application/ld+json">`.
 *
 * `JSON.stringify` alone is not safe: a string containing `</script>` closes the
 * element early (an XSS vector when content is user-authored), `<!--` can change
 * how the HTML parser treats the script body, and U+2028/U+2029 are line
 * terminators in older JavaScript parsers. Escaping `<`, `>`, `&`, U+2028 and
 * U+2029 as `\uXXXX` keeps the JSON identical when parsed.
 */
export function serializeJsonLd(
  value: JsonLdObject | readonly JsonLdObject[],
  space?: number,
): string {
  return JSON.stringify(value, null, space).replace(
    /[<>&\u2028\u2029]/g,
    (ch) => SCRIPT_UNSAFE[ch] ?? ch,
  )
}

/** A complete `<script type="application/ld+json">` element. */
export function jsonLdScriptTag(
  value: JsonLdObject | readonly JsonLdObject[],
  options: { readonly nonce?: string } = {},
): string {
  const nonce =
    options.nonce === undefined ? "" : ` nonce="${options.nonce.replace(/[^A-Za-z0-9+/=_-]/g, "")}"`
  return `<script type="application/ld+json"${nonce}>${serializeJsonLd(value)}</script>`
}
