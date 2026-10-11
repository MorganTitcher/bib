/**
 * robots.txt (RFC 9309) builder with a maintained registry of AI crawler
 * user-agent tokens and simple allow/block policies.
 *
 * Two RFC 9309 facts shape the API:
 * - A crawler obeys only the single most specific group that names it, so an
 *   AI crawler named in its own group ignores the `*` group entirely. Naming a
 *   crawler you welcome keeps it allowed even if `*` later gains a Disallow.
 * - Disallow stops fetching, not indexing. A URL that relies on `noindex`
 *   (meta tag or `X-Robots-Tag`) must stay crawlable, or the crawler never sees
 *   the noindex and the URL can stay in the index.
 *
 * robots.txt is a request, not access control: any client can send any user
 * agent, and several operators say their user-triggered fetchers may not apply
 * robots.txt. Never use this registry to grant access at a firewall.
 */

/**
 * What the operator says the token is for.
 *
 * - `search` — builds an index that AI answers cite and link to.
 * - `user-fetch` — fetches a page because a person asked; some operators say
 *   robots.txt may not apply.
 * - `training` — gathers model-training data, including control tokens that
 *   never crawl but govern whether another crawler's data may train.
 * - `ads` — checks ad landing pages; not search, not training.
 */
export type AiCrawlerPurpose = "search" | "user-fetch" | "training" | "ads"

export interface AiCrawler {
  /** The robots.txt user-agent token, spelled as the operator documents it. */
  readonly token: string
  readonly operator: string
  readonly purpose: AiCrawlerPurpose
  /** A control token: it never fetches, it only governs another crawler's data. */
  readonly controlOnly?: true
  /** The operator's own page stating the purpose. */
  readonly source: string
}

/**
 * The day every {@link AI_CRAWLERS} source below was read on the operator's own
 * page (each entry's `source`). Sources read 2026-10-11:
 * - OpenAI: https://developers.openai.com/api/docs/bots
 * - Anthropic: https://support.claude.com/en/articles/8896518
 * - Google: https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers
 * - Apple: https://support.apple.com/en-us/119829
 * - Perplexity: https://docs.perplexity.ai/docs/resources/perplexity-crawlers
 * - Meta: https://developers.facebook.com/documentation/sharing/webmasters/web-crawlers
 * - Amazon: https://developer.amazon.com/amazonbot
 * - Mistral: https://docs.mistral.ai/robots
 * - DuckDuckGo: https://duckduckgo.com/duckduckgo-help-pages/results/duckassistbot
 * - Common Crawl: https://commoncrawl.org/ccbot
 *
 * Re-read them when this date is more than a few months old; operators rename
 * and retire tokens.
 */
export const AI_CRAWLERS_REVIEWED = "2026-10-11"

const OPENAI = "https://developers.openai.com/api/docs/bots"
const ANTHROPIC = "https://support.claude.com/en/articles/8896518"
const GOOGLE =
  "https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers"
const APPLE = "https://support.apple.com/en-us/119829"
const PERPLEXITY = "https://docs.perplexity.ai/docs/resources/perplexity-crawlers"
const META = "https://developers.facebook.com/documentation/sharing/webmasters/web-crawlers"
const AMAZON = "https://developer.amazon.com/amazonbot"
const MISTRAL = "https://docs.mistral.ai/robots"
const DUCKDUCKGO = "https://duckduckgo.com/duckduckgo-help-pages/results/duckassistbot"
const COMMON_CRAWL = "https://commoncrawl.org/ccbot"

/** AI crawler tokens whose purpose is documented by the operator itself. */
export const AI_CRAWLERS: readonly AiCrawler[] = [
  { token: "OAI-SearchBot", operator: "OpenAI", purpose: "search", source: OPENAI },
  { token: "ChatGPT-User", operator: "OpenAI", purpose: "user-fetch", source: OPENAI },
  { token: "GPTBot", operator: "OpenAI", purpose: "training", source: OPENAI },
  { token: "OAI-AdsBot", operator: "OpenAI", purpose: "ads", source: OPENAI },
  { token: "Claude-SearchBot", operator: "Anthropic", purpose: "search", source: ANTHROPIC },
  { token: "Claude-User", operator: "Anthropic", purpose: "user-fetch", source: ANTHROPIC },
  { token: "ClaudeBot", operator: "Anthropic", purpose: "training", source: ANTHROPIC },
  { token: "PerplexityBot", operator: "Perplexity", purpose: "search", source: PERPLEXITY },
  { token: "Perplexity-User", operator: "Perplexity", purpose: "user-fetch", source: PERPLEXITY },
  // Gemini training. Does not affect Google Search inclusion; Googlebot is not listed here.
  {
    token: "Google-Extended",
    operator: "Google",
    purpose: "training",
    controlOnly: true,
    source: GOOGLE,
  },
  // Applebot serves Spotlight/Siri/Safari search; this token only governs training use.
  {
    token: "Applebot-Extended",
    operator: "Apple",
    purpose: "training",
    controlOnly: true,
    source: APPLE,
  },
  { token: "Meta-WebIndexer", operator: "Meta", purpose: "search", source: META },
  { token: "Meta-ExternalFetcher", operator: "Meta", purpose: "user-fetch", source: META },
  { token: "meta-externalagent", operator: "Meta", purpose: "training", source: META },
  { token: "meta-externalads", operator: "Meta", purpose: "ads", source: META },
  { token: "Amzn-SearchBot", operator: "Amazon", purpose: "search", source: AMAZON },
  { token: "Amzn-User", operator: "Amazon", purpose: "user-fetch", source: AMAZON },
  // "may also be used to train Amazon AI models".
  { token: "Amazonbot", operator: "Amazon", purpose: "training", source: AMAZON },
  { token: "MistralAI-Index", operator: "Mistral", purpose: "search", source: MISTRAL },
  { token: "MistralAI-User", operator: "Mistral", purpose: "user-fetch", source: MISTRAL },
  { token: "MistralAI-Training", operator: "Mistral", purpose: "training", source: MISTRAL },
  // Real-time fetches for cited DuckAssist answers; "not used … to train AI models".
  { token: "DuckAssistBot", operator: "DuckDuckGo", purpose: "search", source: DUCKDUCKGO },
  // Open web archive widely used as a training corpus.
  { token: "CCBot", operator: "Common Crawl", purpose: "training", source: COMMON_CRAWL },
]

/**
 * Tokens seen in the wild whose purpose only third parties describe. Kept
 * separate so a policy can choose to block them without pretending to know
 * what they are for. `Bytespider` is the commonly blocked scraper.
 */
export const UNVERIFIED_AI_CRAWLERS: readonly string[] = ["Bytespider", "YouBot"]

/** Tokens with any of the given purposes, in registry order. */
export function aiCrawlerTokens(...purposes: readonly AiCrawlerPurpose[]): string[] {
  return AI_CRAWLERS.filter((c) => purposes.includes(c.purpose)).map((c) => c.token)
}

export interface RobotsGroup {
  /** One or more user-agent tokens; `*` for everyone. */
  readonly userAgent: string | readonly string[]
  readonly allow?: readonly string[]
  readonly disallow?: readonly string[]
  /** Non-standard (Bing/Yandex honour it, Google ignores it). Seconds. */
  readonly crawlDelay?: number
  /** Comment written above the group. */
  readonly comment?: string
}

/**
 * Ready-made AI policies:
 * - `allow-all` — name every registry token in an allow group.
 * - `block-training` — allow search, user-fetch and ads tokens; disallow training tokens.
 * - `block-all` — disallow every registry token.
 * Every policy also disallows {@link UNVERIFIED_AI_CRAWLERS} unless
 * `blockUnverified: false`.
 */
export type AiPolicy = "allow-all" | "block-training" | "block-all"

export interface RobotsInput {
  /** Groups written first, in order. Defaults to `User-agent: *` / `Allow: /`. */
  readonly groups?: readonly RobotsGroup[]
  readonly aiPolicy?: AiPolicy
  /** Default true. */
  readonly blockUnverified?: boolean
  /** Absolute sitemap URLs. */
  readonly sitemaps?: readonly string[]
  /** Header comment lines. */
  readonly header?: readonly string[]
}

const PATH_RULE = /^(\/|\*)[^\s#]*$/

function checkPath(path: string, field: string): void {
  if (path !== "" && !PATH_RULE.test(path)) {
    throw new RangeError(
      `${field}: rule paths must start with "/" or "*" and contain no whitespace or "#", got ${JSON.stringify(path)}`,
    )
  }
}

const TOKEN = /^[A-Za-z0-9_*.-]+$/

function comment(text: string): string[] {
  return text.split(/\r?\n/).map((line) => `# ${line}`.trimEnd())
}

/** The groups an {@link AiPolicy} expands to. */
export function aiPolicyGroups(policy: AiPolicy, blockUnverified = true): RobotsGroup[] {
  const groups: RobotsGroup[] = []
  if (policy === "allow-all") {
    groups.push({
      userAgent: aiCrawlerTokens("search", "user-fetch", "training", "ads"),
      allow: ["/"],
      comment: "AI crawlers: welcome",
    })
  } else if (policy === "block-training") {
    groups.push({
      userAgent: aiCrawlerTokens("search", "user-fetch", "ads"),
      allow: ["/"],
      comment: "AI search and user fetches: welcome",
    })
    groups.push({
      userAgent: aiCrawlerTokens("training"),
      disallow: ["/"],
      comment: "AI training: opted out",
    })
  } else {
    groups.push({
      userAgent: aiCrawlerTokens("search", "user-fetch", "training", "ads"),
      disallow: ["/"],
      comment: "AI crawlers: opted out",
    })
  }
  if (blockUnverified) {
    groups.push({
      userAgent: UNVERIFIED_AI_CRAWLERS,
      disallow: ["/"],
      comment: "Crawlers with no operator-documented purpose",
    })
  }
  return groups
}

/**
 * Build a robots.txt body. Each user agent may appear in only one group (a
 * duplicate would make the effective rules depend on crawler-specific merging),
 * so a token you place in `groups` is removed from the AI policy groups.
 */
export function buildRobotsTxt(input: RobotsInput = {}): string {
  const custom = input.groups ?? [{ userAgent: "*", allow: ["/"] }]
  const claimed = new Set<string>()
  for (const g of custom) {
    for (const ua of [g.userAgent].flat()) {
      const key = ua.toLowerCase()
      if (claimed.has(key))
        throw new RangeError(`user-agent "${ua}" appears in more than one group`)
      claimed.add(key)
    }
  }
  const policyGroups =
    input.aiPolicy === undefined
      ? []
      : aiPolicyGroups(input.aiPolicy, input.blockUnverified ?? true)
          .map((g) => ({
            ...g,
            userAgent: [g.userAgent].flat().filter((ua) => !claimed.has(ua.toLowerCase())),
          }))
          .filter((g) => g.userAgent.length > 0)

  const blocks: string[] = []
  if (input.header?.length) blocks.push(input.header.flatMap(comment).join("\n"))
  for (const g of [...custom, ...policyGroups]) {
    const agents = [g.userAgent].flat()
    if (agents.length === 0) throw new RangeError("a group needs at least one user-agent")
    const lines: string[] = g.comment === undefined ? [] : comment(g.comment)
    for (const ua of agents) {
      if (!TOKEN.test(ua)) throw new RangeError(`invalid user-agent token ${JSON.stringify(ua)}`)
      lines.push(`User-agent: ${ua}`)
    }
    for (const p of g.allow ?? []) {
      checkPath(p, "allow")
      lines.push(`Allow: ${p}`)
    }
    for (const p of g.disallow ?? []) {
      checkPath(p, "disallow")
      lines.push(`Disallow: ${p}`)
    }
    if ((g.allow?.length ?? 0) + (g.disallow?.length ?? 0) === 0) lines.push("Disallow:")
    if (g.crawlDelay !== undefined) {
      if (!(g.crawlDelay >= 0)) throw new RangeError("crawlDelay must be non-negative")
      lines.push(`Crawl-delay: ${g.crawlDelay}`)
    }
    blocks.push(lines.join("\n"))
  }
  const sitemaps = (input.sitemaps ?? []).map((s) => {
    if (!/^https?:\/\/\S+$/.test(s))
      throw new RangeError(`sitemap must be an absolute URL, got ${s}`)
    return `Sitemap: ${s}`
  })
  if (sitemaps.length) blocks.push(sitemaps.join("\n"))
  return `${blocks.join("\n\n")}\n`
}

/** robots.txt for a non-production deployment: disallow everything, no sitemap. */
export function disallowAllRobotsTxt(): string {
  return "User-agent: *\nDisallow: /\n"
}
