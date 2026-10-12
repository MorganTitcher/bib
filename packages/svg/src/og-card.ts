/**
 * Open Graph / social card templates rendered as 1200x630 SVG.
 *
 * Text is wrapped and truncated with the estimated metrics from
 * `@bib/svg/text-metrics`, so layout never depends on a font engine. The SVG
 * can be served directly where SVG is accepted, or rasterized by a separate
 * renderer; this module does no rasterization.
 */
import { normalizeWhitespace } from "@bib/shared/strings"
import { contrastRatio, parseColor, toHex } from "./color.ts"
import { h, svg } from "./element.ts"
import { formatNumber } from "./escape.ts"
import { wrapText } from "./text-metrics.ts"

/** Standard Open Graph image width in px. */
export const OG_WIDTH = 1200
/** Standard Open Graph image height in px. */
export const OG_HEIGHT = 630

export interface OgTheme {
  readonly background: string
  readonly foreground: string
  readonly muted: string
  readonly accent: string
}

/** Dark default theme; every pairing with the background clears WCAG AA. */
export const OG_DARK_THEME: OgTheme = {
  background: "#0f172a",
  foreground: "#f8fafc",
  muted: "#cbd5e1",
  accent: "#38bdf8",
}

/** Light theme. */
export const OG_LIGHT_THEME: OgTheme = {
  background: "#ffffff",
  foreground: "#0f172a",
  muted: "#475569",
  accent: "#1d4ed8",
}

export interface OgCardOptions {
  /** Headline; wrapped to at most `maxTitleLines` lines. */
  readonly title: string
  /** Supporting line(s) below the title. */
  readonly subtitle?: string
  /** Small uppercase kicker above the title (category, section). */
  readonly eyebrow?: string
  /** Bottom line, typically a site name or URL. */
  readonly footer?: string
  readonly theme?: Partial<OgTheme>
  readonly fontFamily?: string
  /** Default 3. */
  readonly maxTitleLines?: number
  /** Default 3; reduced automatically when the title leaves no room. */
  readonly maxSubtitleLines?: number
}

export interface OgCard {
  readonly svg: string
  readonly titleLines: readonly string[]
  readonly subtitleLines: readonly string[]
  /** True when any text was cut to fit. */
  readonly truncated: boolean
  /** Theme pairings that fall below WCAG AA (4.5:1) against the background. */
  readonly lowContrast: readonly (keyof Omit<OgTheme, "background">)[]
}

const KEY_GLYPHS: Readonly<Record<string, string>> = {
  "⌘": "Cmd+",
  "⇧": "Shift+",
  "⌥": "Alt+",
  "⌃": "Ctrl+",
  "⏎": "Enter",
  "↵": "Enter",
}

/**
 * Normalize text for social images: control characters removed, whitespace
 * collapsed, and keyboard-symbol glyphs that common fallback fonts lack
 * spelled out (`⌘K` becomes `Cmd+K`).
 */
export function normalizeCardText(text: string): string {
  const spelled = text.replace(/[⌘⇧⌥⌃⏎↵]/g, (glyph) => KEY_GLYPHS[glyph] ?? glyph)
  return normalizeWhitespace(spelled.replace(/\p{Cc}/gu, " "))
}

function themeColor(value: string, field: string): string {
  const parsed = parseColor(value)
  if (parsed === null) throw new TypeError(`unrecognized ${field} color: ${JSON.stringify(value)}`)
  return toHex({ ...parsed, alpha: 1 })
}

const PADDING = 80
const EYEBROW_SIZE = 28
const TITLE_SIZE = 64
const SUBTITLE_SIZE = 32
const FOOTER_SIZE = 26
const LINE_HEIGHT = 1.2

/**
 * Render a social card.
 *
 * @example
 * ```ts
 * const card = renderOgCard({ eyebrow: "Guide", title: "Shipping static badges", footer: "example.com" })
 * card.svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"') // true
 * ```
 *
 * @throws TypeError when the title is empty or a theme color cannot be parsed.
 */
export function renderOgCard(options: OgCardOptions): OgCard {
  const theme = { ...OG_DARK_THEME, ...options.theme }
  const background = themeColor(theme.background, "background")
  const foreground = themeColor(theme.foreground, "foreground")
  const muted = themeColor(theme.muted, "muted")
  const accent = themeColor(theme.accent, "accent")
  const fontFamily = options.fontFamily ?? "Inter,Helvetica,Arial,sans-serif"

  const title = normalizeCardText(options.title)
  if (title === "") throw new TypeError("card title must not be empty")
  const subtitle = normalizeCardText(options.subtitle ?? "")
  const eyebrow = normalizeCardText(options.eyebrow ?? "").toUpperCase()
  const footer = normalizeCardText(options.footer ?? "")

  const textWidth = OG_WIDTH - PADDING * 2
  let truncated = false
  let y = PADDING
  const children = []

  if (eyebrow !== "") {
    const wrapped = wrapText(eyebrow, textWidth, {
      fontSize: EYEBROW_SIZE,
      bold: true,
      maxLines: 1,
    })
    truncated ||= wrapped.truncated
    y += EYEBROW_SIZE
    children.push(
      h(
        "text",
        {
          x: PADDING,
          y,
          fill: accent,
          "font-size": EYEBROW_SIZE,
          "font-weight": 700,
          "letter-spacing": 2,
        },
        wrapped.lines[0] ?? "",
      ),
    )
    y += 28
  }

  const titleWrap = wrapText(title, textWidth, {
    fontSize: TITLE_SIZE,
    bold: true,
    maxLines: options.maxTitleLines ?? 3,
  })
  truncated ||= titleWrap.truncated
  const titleLineHeight = TITLE_SIZE * LINE_HEIGHT
  for (const line of titleWrap.lines) {
    y += titleLineHeight
    children.push(
      h(
        "text",
        {
          x: PADDING,
          y: formatNumber(y - (titleLineHeight - TITLE_SIZE)),
          fill: foreground,
          "font-size": TITLE_SIZE,
          "font-weight": 700,
        },
        line,
      ),
    )
  }

  const footerTop = footer === "" ? OG_HEIGHT - PADDING : OG_HEIGHT - PADDING - FOOTER_SIZE - 24
  const subtitleLineHeight = SUBTITLE_SIZE * LINE_HEIGHT
  const subtitleStart = y + 24
  const room = Math.max(0, Math.floor((footerTop - subtitleStart) / subtitleLineHeight))
  const subtitleMax = Math.min(options.maxSubtitleLines ?? 3, room)
  let subtitleLines: string[] = []
  if (subtitle !== "") {
    if (subtitleMax === 0) truncated = true
    else {
      const wrapped = wrapText(subtitle, textWidth, {
        fontSize: SUBTITLE_SIZE,
        maxLines: subtitleMax,
      })
      truncated ||= wrapped.truncated
      subtitleLines = wrapped.lines
      y = subtitleStart
      for (const line of subtitleLines) {
        y += subtitleLineHeight
        children.push(
          h(
            "text",
            {
              x: PADDING,
              y: formatNumber(y - (subtitleLineHeight - SUBTITLE_SIZE)),
              fill: muted,
              "font-size": SUBTITLE_SIZE,
            },
            line,
          ),
        )
      }
    }
  }

  if (footer !== "") {
    const wrapped = wrapText(footer, textWidth, { fontSize: FOOTER_SIZE, maxLines: 1 })
    truncated ||= wrapped.truncated
    children.push(
      h(
        "text",
        { x: PADDING, y: OG_HEIGHT - PADDING, fill: muted, "font-size": FOOTER_SIZE },
        wrapped.lines[0] ?? "",
      ),
    )
  }

  const label = [eyebrow, title, subtitle].filter((part) => part !== "").join(" — ")
  const markup = svg(
    {
      width: OG_WIDTH,
      height: OG_HEIGHT,
      viewBox: `0 0 ${OG_WIDTH} ${OG_HEIGHT}`,
      role: "img",
      "aria-label": label,
    },
    h("title", {}, title),
    h("rect", { width: OG_WIDTH, height: OG_HEIGHT, fill: background }),
    h("rect", { width: 12, height: OG_HEIGHT, fill: accent }),
    h("g", { "font-family": fontFamily }, ...children),
  )

  const lowContrast = (["foreground", "muted", "accent"] as const).filter(
    (field) => contrastRatio({ foreground, muted, accent }[field], background) < 4.5,
  )

  return {
    svg: markup.value,
    titleLines: titleWrap.lines,
    subtitleLines,
    truncated,
    lowContrast,
  }
}
