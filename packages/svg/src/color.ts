/**
 * Color parsing and conversion (hex, `rgb()`, OKLCH), WCAG 2 contrast, and a
 * readable-text picker.
 *
 * Channels are sRGB 0-255. OKLCH uses lightness 0-1, chroma 0 and up, hue in
 * degrees. Conversions follow Björn Ottosson's OKLab definition (the one CSS
 * Color 4 uses). Out-of-gamut OKLCH colors are mapped into sRGB by reducing
 * chroma at constant lightness and hue, then clipping the remainder.
 */
import { formatNumber } from "./escape.ts"

/** An sRGB color with 0-255 channels and 0-1 alpha. */
export interface Rgb {
  readonly r: number
  readonly g: number
  readonly b: number
  readonly alpha: number
}

/** An OKLCH color: lightness 0-1, chroma >= 0, hue in degrees [0, 360), alpha 0-1. */
export interface Oklch {
  readonly l: number
  readonly c: number
  readonly h: number
  readonly alpha: number
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

/** Build an {@link Rgb}, clamping channels to 0-255 and alpha to 0-1. */
export function rgb(r: number, g: number, b: number, alpha = 1): Rgb {
  return {
    r: clamp(r, 0, 255),
    g: clamp(g, 0, 255),
    b: clamp(b, 0, 255),
    alpha: clamp(alpha, 0, 1),
  }
}

/** Parse `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa` (case-insensitive). Returns `null` otherwise. */
export function parseHex(input: string): Rgb | null {
  const match = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(input.trim())
  const digits = match?.[1]
  if (digits === undefined) return null
  const full = digits.length <= 4 ? [...digits].map((d) => d + d).join("") : digits
  const channel = (i: number): number => Number.parseInt(full.slice(i * 2, i * 2 + 2), 16)
  return rgb(channel(0), channel(1), channel(2), full.length === 8 ? channel(3) / 255 : 1)
}

const hex2 = (value: number): string =>
  Math.round(clamp(value, 0, 255))
    .toString(16)
    .padStart(2, "0")

/** Format as lowercase `#rrggbb`, or `#rrggbbaa` when alpha is below 1. */
export function toHex(color: Rgb): string {
  const base = `#${hex2(color.r)}${hex2(color.g)}${hex2(color.b)}`
  return color.alpha < 1 ? base + hex2(color.alpha * 255) : base
}

/** Format as `rgb(r g b)` or `rgb(r g b / a)` (CSS Color 4 syntax). */
export function formatRgb(color: Rgb): string {
  const body = `${Math.round(color.r)} ${Math.round(color.g)} ${Math.round(color.b)}`
  return color.alpha < 1 ? `rgb(${body} / ${formatNumber(color.alpha)})` : `rgb(${body})`
}

function parseChannel(token: string, scale: number): number | null {
  const pct = /^([-+]?(?:\d+\.?\d*|\.\d+))%$/.exec(token)
  if (pct?.[1] !== undefined) return (Number(pct[1]) / 100) * scale
  if (/^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i.test(token)) return Number(token)
  return null
}

function splitFunctionArgs(body: string): { values: string[]; alpha: string | undefined } | null {
  const [main, alpha, extra] = body.split("/").map((part) => part.trim())
  if (main === undefined || extra !== undefined) return null
  const values = main.split(/[\s,]+/).filter((token) => token !== "")
  return { values, alpha: alpha === "" ? undefined : alpha }
}

function parseRgbFunction(input: string): Rgb | null {
  const match = /^rgba?\(\s*([^)]*)\)$/i.exec(input.trim())
  const body = match?.[1]
  if (body === undefined) return null
  const args = splitFunctionArgs(body)
  if (args === null) return null
  let alphaToken = args.alpha
  const values = [...args.values]
  if (alphaToken === undefined && values.length === 4) alphaToken = values.pop()
  if (values.length !== 3) return null
  const channels = values.map((token) => parseChannel(token, 255))
  const alpha = alphaToken === undefined ? 1 : parseChannel(alphaToken, 1)
  const [r, g, b] = channels
  if (r == null || g == null || b == null || alpha === null) return null
  return rgb(r, g, b, alpha)
}

/** Parse `oklch(L C H)` / `oklch(L C H / A)`; `L` may be 0-1 or a percentage. */
export function parseOklch(input: string): Oklch | null {
  const match = /^oklch\(\s*([^)]*)\)$/i.exec(input.trim())
  const body = match?.[1]
  if (body === undefined) return null
  const args = splitFunctionArgs(body)
  if (args === null || args.values.length !== 3) return null
  const [lToken, cToken, hToken] = args.values
  if (lToken === undefined || cToken === undefined || hToken === undefined) return null
  const l = parseChannel(lToken, 1)
  const c = parseChannel(cToken, 0.4)
  const h = hToken === "none" ? 0 : parseChannel(hToken.replace(/deg$/i, ""), 360)
  const alpha = args.alpha === undefined ? 1 : parseChannel(args.alpha, 1)
  if (l === null || c === null || h === null || alpha === null) return null
  return {
    l: clamp(l, 0, 1),
    c: Math.max(0, c),
    h: ((h % 360) + 360) % 360,
    alpha: clamp(alpha, 0, 1),
  }
}

/** Format as `oklch(L% C H)` with up to 4 decimals. */
export function formatOklch(color: Oklch): string {
  const body = `${formatNumber(color.l * 100, 2)}% ${formatNumber(color.c, 4)} ${formatNumber(color.h, 2)}`
  return color.alpha < 1 ? `oklch(${body} / ${formatNumber(color.alpha)})` : `oklch(${body})`
}

const toLinear = (channel: number): number => {
  const c = channel / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

const fromLinear = (value: number): number => {
  const c = value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055
  return c * 255
}

/** Convert sRGB to OKLCH. Achromatic colors get hue 0. */
export function rgbToOklch(color: Rgb): Oklch {
  const r = toLinear(color.r)
  const g = toLinear(color.g)
  const b = toLinear(color.b)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  const c = Math.hypot(A, B)
  const h = c < 1e-4 ? 0 : ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360
  return { l: L, c: c < 1e-4 ? 0 : c, h, alpha: color.alpha }
}

function oklchToLinear(color: Oklch): [number, number, number] {
  const hr = (color.h * Math.PI) / 180
  const A = color.c * Math.cos(hr)
  const B = color.c * Math.sin(hr)
  const l = (color.l + 0.3963377774 * A + 0.2158037573 * B) ** 3
  const m = (color.l - 0.1055613458 * A - 0.0638541728 * B) ** 3
  const s = (color.l - 0.0894841775 * A - 1.291485548 * B) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

const inGamut = ([r, g, b]: [number, number, number]): boolean => {
  const e = 1e-6
  return r >= -e && r <= 1 + e && g >= -e && g <= 1 + e && b >= -e && b <= 1 + e
}

/** True when the OKLCH color is representable in sRGB without clipping. */
export function isInSrgbGamut(color: Oklch): boolean {
  return inGamut(oklchToLinear(color))
}

/** Convert OKLCH to sRGB, reducing chroma to fit the sRGB gamut when needed. */
export function oklchToRgb(color: Oklch): Rgb {
  let linear = oklchToLinear(color)
  if (!inGamut(linear)) {
    let lo = 0
    let hi = color.c
    for (let i = 0; i < 24; i += 1) {
      const mid = (lo + hi) / 2
      if (inGamut(oklchToLinear({ ...color, c: mid }))) lo = mid
      else hi = mid
    }
    linear = oklchToLinear({ ...color, c: lo })
  }
  const [r, g, b] = linear.map((v) => fromLinear(clamp(v, 0, 1))) as [number, number, number]
  return rgb(r, g, b, color.alpha)
}

/** Parse a hex, `rgb()`/`rgba()` or `oklch()` color. Returns `null` for anything else. */
export function parseColor(input: string): Rgb | null {
  const text = input.trim()
  if (text.startsWith("#")) return parseHex(text)
  if (/^rgba?\(/i.test(text)) return parseRgbFunction(text)
  const oklch = parseOklch(text)
  return oklch === null ? null : oklchToRgb(oklch)
}

/** Composite a translucent color over an opaque background (alpha blending in sRGB). */
export function flatten(color: Rgb, background: Rgb): Rgb {
  const a = color.alpha
  return rgb(
    color.r * a + background.r * (1 - a),
    color.g * a + background.g * (1 - a),
    color.b * a + background.b * (1 - a),
  )
}

/** WCAG 2 relative luminance (0 for black, 1 for white). Alpha is ignored. */
export function relativeLuminance(color: Rgb): number {
  return 0.2126 * toLinear(color.r) + 0.7152 * toLinear(color.g) + 0.0722 * toLinear(color.b)
}

type ColorInput = Rgb | string

function resolve(input: ColorInput): Rgb {
  if (typeof input !== "string") return input
  const parsed = parseColor(input)
  if (parsed === null) throw new TypeError(`unrecognized color: ${JSON.stringify(input)}`)
  return parsed
}

/**
 * WCAG 2 contrast ratio between two colors, from 1 to 21. Translucent colors
 * are flattened over the other color (or over white when both are translucent).
 *
 * @throws TypeError when a string color cannot be parsed.
 */
export function contrastRatio(foreground: ColorInput, background: ColorInput): number {
  let fg = resolve(foreground)
  let bg = resolve(background)
  if (bg.alpha < 1) bg = flatten(bg, rgb(255, 255, 255))
  if (fg.alpha < 1) fg = flatten(fg, bg)
  const a = relativeLuminance(fg)
  const b = relativeLuminance(bg)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

export type WcagLevel = "AA" | "AAA"

/**
 * Minimum ratio WCAG 2 requires: AA 4.5 (3 for large text), AAA 7 (4.5 for
 * large text). Large text is at least 18pt, or 14pt bold.
 */
export function minimumContrast(level: WcagLevel = "AA", largeText = false): number {
  if (level === "AAA") return largeText ? 4.5 : 7
  return largeText ? 3 : 4.5
}

/** True when the pair meets the given WCAG level. */
export function meetsContrast(
  foreground: ColorInput,
  background: ColorInput,
  level: WcagLevel = "AA",
  largeText = false,
): boolean {
  return contrastRatio(foreground, background) >= minimumContrast(level, largeText)
}

/**
 * Pick the candidate with the highest contrast against `background`.
 * Defaults to near-black and white. Ties go to the earlier candidate.
 *
 * @example
 * ```ts
 * pickReadableText("#2563eb") // "#ffffff"
 * pickReadableText("#facc15") // "#111111"
 * ```
 */
export function pickReadableText(
  background: ColorInput,
  candidates: readonly string[] = ["#111111", "#ffffff"],
): string {
  const first = candidates[0]
  if (first === undefined) throw new RangeError("pickReadableText needs at least one candidate")
  let best = first
  let bestRatio = contrastRatio(first, background)
  for (const candidate of candidates.slice(1)) {
    const ratio = contrastRatio(candidate, background)
    if (ratio > bestRatio) {
      best = candidate
      bestRatio = ratio
    }
  }
  return best
}
