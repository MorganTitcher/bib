/**
 * Classify a `document.referrer` / `Referer` header into a traffic type:
 * `search`, `social`, `email`, `referral`, `internal` (same site) or
 * `direct` (no referrer, or one that carries no acquisition signal).
 *
 * Host matching is exact or by subdomain, never a bare suffix, so
 * `notgoogle.com` is a referral, not search. A leading `www.` is ignored.
 * Google and Yahoo country domains (`google.co.uk`, `google.de`) are matched
 * by pattern; other Google subdomains (`docs.google.com`) are referrals.
 *
 * Some hosts sit in the middle of a journey without being its source:
 * sign-in providers and payment pages. They classify as `direct` with
 * `transit: true` so they never overwrite a real source. Webmail hosts
 * classify as `email`.
 *
 * @example
 * ```ts
 * classifyReferrer("https://www.google.co.uk/search?q=x") // { type: "search", source: "google", host: "google.co.uk" }
 * classifyReferrer("https://t.co/abc") // { type: "social", source: "x", host: "t.co" }
 * classifyReferrer("") // { type: "direct" }
 * ```
 */

import { hostMatches, normalizeHost, parseUrl } from "./internal.ts"

export type ReferrerType = "search" | "social" | "email" | "referral" | "internal" | "direct"

/** Result of {@link classifyReferrer}. */
export interface ReferrerClassification {
  readonly type: ReferrerType
  /** Normalized source name (`google`, `x`) or the host for a referral. */
  readonly source?: string
  /** Normalized referrer host, without `www.`. */
  readonly host?: string
  /** True for identity and payment hosts: mid-journey, not a source. */
  readonly transit?: boolean
}

/** Domain to source name. Order matters only when one domain is under another. */
export type HostTable = readonly (readonly [domain: string, source: string])[]

/** Search engines and AI answer engines. */
export const SEARCH_HOSTS: HostTable = [
  ["bing.com", "bing"],
  ["duckduckgo.com", "duckduckgo"],
  ["search.brave.com", "brave"],
  ["ecosia.org", "ecosia"],
  ["startpage.com", "startpage"],
  ["baidu.com", "baidu"],
  ["naver.com", "naver"],
  ["seznam.cz", "seznam"],
  ["qwant.com", "qwant"],
  ["kagi.com", "kagi"],
  ["yandex.ru", "yandex"],
  ["yandex.com", "yandex"],
  ["ya.ru", "yandex"],
  ["sogou.com", "sogou"],
  ["so.com", "360"],
  ["daum.net", "daum"],
  ["aol.com", "aol"],
  ["ask.com", "ask"],
  ["perplexity.ai", "perplexity"],
  ["chatgpt.com", "chatgpt"],
  ["chat.openai.com", "chatgpt"],
  ["claude.ai", "claude"],
  ["copilot.microsoft.com", "copilot"],
  ["gemini.google.com", "gemini"],
  ["you.com", "you"],
]

/** Social networks and community sites. */
export const SOCIAL_HOSTS: HostTable = [
  ["facebook.com", "facebook"],
  ["fb.com", "facebook"],
  ["fb.me", "facebook"],
  ["messenger.com", "facebook"],
  ["instagram.com", "instagram"],
  ["threads.net", "threads"],
  ["threads.com", "threads"],
  ["twitter.com", "x"],
  ["x.com", "x"],
  ["t.co", "x"],
  ["linkedin.com", "linkedin"],
  ["lnkd.in", "linkedin"],
  ["reddit.com", "reddit"],
  ["redd.it", "reddit"],
  ["youtube.com", "youtube"],
  ["youtu.be", "youtube"],
  ["tiktok.com", "tiktok"],
  ["pinterest.com", "pinterest"],
  ["pin.it", "pinterest"],
  ["snapchat.com", "snapchat"],
  ["bsky.app", "bluesky"],
  ["mastodon.social", "mastodon"],
  ["news.ycombinator.com", "hacker_news"],
  ["discord.com", "discord"],
  ["discord.gg", "discord"],
  ["t.me", "telegram"],
  ["telegram.org", "telegram"],
  ["wa.me", "whatsapp"],
  ["whatsapp.com", "whatsapp"],
  ["quora.com", "quora"],
  ["tumblr.com", "tumblr"],
  ["medium.com", "medium"],
  ["vk.com", "vk"],
  ["weibo.com", "weibo"],
  ["producthunt.com", "product_hunt"],
]

/** Webmail clients: a click from here is an email click. */
export const EMAIL_HOSTS: HostTable = [
  ["mail.google.com", "gmail"],
  ["outlook.live.com", "outlook"],
  ["outlook.office.com", "outlook"],
  ["outlook.office365.com", "outlook"],
  ["mail.yahoo.com", "yahoo_mail"],
  ["mail.aol.com", "aol_mail"],
  ["mail.proton.me", "proton_mail"],
  ["mail.zoho.com", "zoho_mail"],
  ["fastmail.com", "fastmail"],
  ["icloud.com", "icloud_mail"],
]

/** Identity and payment hosts that sit mid-journey. */
export const TRANSIT_HOSTS: readonly string[] = [
  "accounts.google.com",
  "login.microsoftonline.com",
  "login.live.com",
  "appleid.apple.com",
  "github.com/login",
  "auth0.com",
  "okta.com",
  "checkout.stripe.com",
  "stripe.com",
  "paypal.com",
  "pay.google.com",
]

// Bare google.<tld> only (www. is already stripped): docs.google.com is not search.
const GOOGLE_HOST = /^google\.(?:com|[a-z]{2,3}|(?:com|co)\.[a-z]{2})$/
const YAHOO_SEARCH_HOST = /^(?:[a-z]{2}\.)?search\.yahoo\.(?:com|co\.jp|[a-z]{2})$/

/** Options for {@link classifyReferrer}. */
export interface ClassifyReferrerOptions {
  /**
   * Hosts that count as this site, so a same-site navigation is `internal`.
   * Subdomains match too: `example.com` covers `app.example.com`.
   */
  readonly siteHosts?: readonly string[]
  readonly searchHosts?: HostTable
  readonly socialHosts?: HostTable
  readonly emailHosts?: HostTable
  readonly transitHosts?: readonly string[]
}

function lookup(host: string, table: HostTable): string | undefined {
  for (const [domain, source] of table) {
    if (hostMatches(host, domain)) return source
  }
  return undefined
}

/** Classify a referrer URL. Missing, empty or unparseable input is `direct`. */
export function classifyReferrer(
  referrer: string | null | undefined,
  options: ClassifyReferrerOptions = {},
): ReferrerClassification {
  if (typeof referrer !== "string" || referrer.trim() === "") return { type: "direct" }
  const url = parseUrl(referrer.trim())
  if (url === undefined || (url.protocol !== "http:" && url.protocol !== "https:")) {
    // android-app:// and similar schemes carry an app id, not a web source.
    return { type: "direct" }
  }
  const host = normalizeHost(url.hostname)
  if (host === undefined) return { type: "direct" }

  for (const site of options.siteHosts ?? []) {
    const siteHost = normalizeHost(site)
    if (siteHost !== undefined && hostMatches(host, siteHost)) return { type: "internal", host }
  }

  const path = url.pathname
  for (const transit of options.transitHosts ?? TRANSIT_HOSTS) {
    const [domain = "", ...rest] = transit.split("/")
    const transitPath = rest.length > 0 ? `/${rest.join("/")}` : ""
    if (hostMatches(host, domain) && path.startsWith(transitPath)) {
      return { type: "direct", host, transit: true }
    }
  }

  // Webmail before search: mail.google.com is also a google.* host.
  const email = lookup(host, options.emailHosts ?? EMAIL_HOSTS)
  if (email !== undefined) return { type: "email", source: email, host }

  const search = lookup(host, options.searchHosts ?? SEARCH_HOSTS)
  if (search !== undefined) return { type: "search", source: search, host }
  if (GOOGLE_HOST.test(host)) return { type: "search", source: "google", host }
  if (YAHOO_SEARCH_HOST.test(host) || host === "yahoo.com") {
    return { type: "search", source: "yahoo", host }
  }

  const social = lookup(host, options.socialHosts ?? SOCIAL_HOSTS)
  if (social !== undefined) return { type: "social", source: social, host }

  return { type: "referral", source: host, host }
}
