/**
 * Shields-style status and metric badges as standalone SVG strings.
 *
 * Labels are cleaned (control characters removed, whitespace collapsed) and
 * clamped before they are measured, and escaped only when serialized, so
 * entity text never inflates the measured width. Colors are emitted as static
 * hex because image proxies that re-serve badges commonly strip CSS variables
 * and newer color syntaxes. Text color is chosen for contrast against each
 * segment rather than fixed to white.
 */
import { fnv1a32 } from "@bib/shared/hashing"
import { normalizeWhitespace, truncate } from "@bib/shared/strings"
import { contrastRatio, parseColor, pickReadableText, toHex } from "./color.ts"
import { h, svg } from "./element.ts"
import { formatNumber } from "./escape.ts"
import { estimateTextWidth } from "./text-metrics.ts"

/** Badge height in px. */
export const BADGE_HEIGHT = 20
/** Badge font size in px. */
export const BADGE_FONT_SIZE = 11
/** Horizontal padding on each side of a segment's text, in px. */
export const BADGE_PADDING = 6
/** Longest label or message kept, in graphemes; longer text is truncated with "…". */
export const BADGE_MAX_TEXT = 32

const FONT_FAMILY = "Verdana,Geneva,DejaVu Sans,sans-serif"

/** Named colors for convenience; any hex, `rgb()` or `oklch()` string also works. */
export const BADGE_COLORS = {
  green: "#15803d",
  yellow: "#a16207",
  orange: "#c2410c",
  red: "#b91c1c",
  blue: "#1d4ed8",
  grey: "#555555",
} as const

export type BadgeColorName = keyof typeof BADGE_COLORS

export interface BadgeOptions {
  /** Left segment text. Empty or omitted renders a single-segment badge. */
  readonly label?: string
  /** Right segment text. */
  readonly message: string
  /** Right segment background (default blue). */
  readonly color?: BadgeColorName | string
  /** Left segment background (default grey). */
  readonly labelColor?: BadgeColorName | string
  /** `flat` has rounded corners; `flat-square` does not (default `flat`). */
  readonly style?: "flat" | "flat-square"
  /** Accessible name and tooltip; defaults to `"label: message"`. */
  readonly title?: string
}

/** Strip control characters, collapse whitespace, and clamp to {@link BADGE_MAX_TEXT}. */
export function cleanBadgeText(text: string): string {
  return truncate(normalizeWhitespace(text.replace(/\p{Cc}/gu, " ")), BADGE_MAX_TEXT)
}

function resolveColor(value: string): string {
  const named = (BADGE_COLORS as Readonly<Record<string, string>>)[value]
  const parsed = parseColor(named ?? value)
  if (parsed === null) throw new TypeError(`unrecognized badge color: ${JSON.stringify(value)}`)
  return toHex({ ...parsed, alpha: 1 })
}

/** Width in px of a segment holding `text`. */
export function badgeSegmentWidth(text: string): number {
  return Math.round(estimateTextWidth(text, { fontSize: BADGE_FONT_SIZE }) + BADGE_PADDING * 2)
}

/**
 * Render a badge.
 *
 * @example
 * ```ts
 * renderBadge({ label: "build", message: "passing", color: "green" })
 * // '<svg xmlns="http://www.w3.org/2000/svg" width="93" height="20" ...'
 * ```
 *
 * @throws TypeError when a color cannot be parsed, or when the message is empty.
 */
export function renderBadge(options: BadgeOptions): string {
  const label = cleanBadgeText(options.label ?? "")
  const message = cleanBadgeText(options.message)
  if (message === "") throw new TypeError("badge message must not be empty")
  const color = resolveColor(options.color ?? "blue")
  const labelColor = resolveColor(options.labelColor ?? "grey")
  const title = cleanBadgeText(options.title ?? (label === "" ? message : `${label}: ${message}`))
  const labelWidth = label === "" ? 0 : badgeSegmentWidth(label)
  const messageWidth = badgeSegmentWidth(message)
  const width = labelWidth + messageWidth
  const radius = options.style === "flat-square" ? 0 : 3
  // 32-bit FNV-1a of the inputs: a stable, collision-resistant element id.
  const idHash = fnv1a32(`${label}|${message}|${color}|${labelColor}|${radius}`)
  const clipId = `badge-${idHash.toString(36)}`
  const textY = 14

  return svg(
    {
      width,
      height: BADGE_HEIGHT,
      viewBox: `0 0 ${width} ${BADGE_HEIGHT}`,
      role: "img",
      "aria-label": title,
    },
    h("title", {}, title),
    h(
      "clipPath",
      { id: clipId },
      h("rect", { width, height: BADGE_HEIGHT, rx: radius || null, fill: "#fff" }),
    ),
    h(
      "g",
      { "clip-path": `url(#${clipId})` },
      labelWidth > 0 && h("rect", { width: labelWidth, height: BADGE_HEIGHT, fill: labelColor }),
      h("rect", { x: labelWidth || null, width: messageWidth, height: BADGE_HEIGHT, fill: color }),
    ),
    h(
      "g",
      { "font-family": FONT_FAMILY, "font-size": BADGE_FONT_SIZE, "text-anchor": "middle" },
      labelWidth > 0 &&
        h(
          "text",
          { x: formatNumber(labelWidth / 2, 1), y: textY, fill: pickReadableText(labelColor) },
          label,
        ),
      h(
        "text",
        {
          x: formatNumber(labelWidth + messageWidth / 2, 1),
          y: textY,
          fill: pickReadableText(color),
        },
        message,
      ),
    ),
  ).value
}

/** A threshold for {@link renderMetricBadge}: values at or above `min` use `color`. */
export interface MetricThreshold {
  readonly min: number
  readonly color: BadgeColorName | string
}

export interface MetricBadgeOptions {
  readonly label: string
  readonly value: number
  /** Appended to the formatted value, e.g. `"%"` or `" ms"`. */
  readonly unit?: string
  /** Decimal places (default 0). */
  readonly digits?: number
  /** Checked from highest `min` down; the first the value reaches wins. */
  readonly thresholds?: readonly MetricThreshold[]
  /** Color when no threshold matches or the value is not finite (default grey). */
  readonly fallbackColor?: BadgeColorName | string
  readonly labelColor?: BadgeColorName | string
  readonly style?: "flat" | "flat-square"
}

/** Coverage-style thresholds: 90+ green, 75+ yellow, 50+ orange, otherwise red. */
export const PERCENT_THRESHOLDS: readonly MetricThreshold[] = [
  { min: 90, color: "green" },
  { min: 75, color: "yellow" },
  { min: 50, color: "orange" },
  { min: Number.NEGATIVE_INFINITY, color: "red" },
]

/** Pick the color for `value` from `thresholds` (highest `min` first). */
export function metricColor(
  value: number,
  thresholds: readonly MetricThreshold[],
  fallback: BadgeColorName | string = "grey",
): BadgeColorName | string {
  if (!Number.isFinite(value)) return fallback
  const sorted = [...thresholds].sort((a, b) => b.min - a.min)
  return sorted.find((t) => value >= t.min)?.color ?? fallback
}

/**
 * Render a numeric badge whose color follows thresholds. Non-finite values
 * render as "n/a" in the fallback color.
 *
 * @example
 * ```ts
 * renderMetricBadge({ label: "coverage", value: 87.4, unit: "%", thresholds: PERCENT_THRESHOLDS })
 * ```
 */
export function renderMetricBadge(options: MetricBadgeOptions): string {
  const finite = Number.isFinite(options.value)
  const message = finite
    ? `${options.value.toFixed(options.digits ?? 0)}${options.unit ?? ""}`
    : "n/a"
  const base: BadgeOptions = {
    label: options.label,
    message,
    color: metricColor(options.value, options.thresholds ?? [], options.fallbackColor ?? "grey"),
  }
  return renderBadge({
    ...base,
    ...(options.labelColor === undefined ? {} : { labelColor: options.labelColor }),
    ...(options.style === undefined ? {} : { style: options.style }),
  })
}

/** Lowest contrast ratio between a badge's text and its segment colors, for checks in tests or CI. */
export function badgeMinimumContrast(
  color: string,
  labelColor: string = BADGE_COLORS.grey,
): number {
  const message = resolveColor(color)
  const label = resolveColor(labelColor)
  return Math.min(
    contrastRatio(pickReadableText(message), message),
    contrastRatio(pickReadableText(label), label),
  )
}
