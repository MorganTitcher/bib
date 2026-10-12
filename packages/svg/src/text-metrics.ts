/**
 * Approximate text width without a font engine.
 *
 * Widths come from a per-character table of Verdana-like advance widths (in
 * 1/2048 em), the metric shields-style badges are laid out with. Characters
 * outside the table fall back by class: East Asian wide and emoji are 1 em,
 * combining marks are zero-width, everything else gets an average width.
 * Results are estimates (typically within ~10% for Latin text in Verdana,
 * DejaVu Sans or similar humanist sans-serifs); leave slack in layouts.
 */

const UNITS_PER_EM = 2048

const ADVANCE: Readonly<Record<string, number>> = {
  " ": 720,
  "!": 823,
  '"': 1063,
  "#": 1716,
  $: 1303,
  "%": 2213,
  "&": 1468,
  "'": 547,
  "(": 930,
  ")": 930,
  "*": 1303,
  "+": 1716,
  ",": 745,
  "-": 889,
  ".": 745,
  "/": 1159,
  ":": 889,
  ";": 889,
  "<": 1716,
  "=": 1716,
  ">": 1716,
  "?": 1114,
  "@": 2048,
  "[": 930,
  "\\": 1159,
  "]": 930,
  "^": 1716,
  _: 1303,
  "`": 1303,
  "{": 1300,
  "|": 930,
  "}": 1300,
  "~": 1716,
  A: 1401,
  B: 1405,
  C: 1430,
  D: 1577,
  E: 1294,
  F: 1178,
  G: 1587,
  H: 1540,
  I: 868,
  J: 921,
  K: 1415,
  L: 1145,
  M: 1729,
  N: 1532,
  O: 1612,
  P: 1247,
  Q: 1612,
  R: 1440,
  S: 1405,
  T: 1243,
  U: 1499,
  V: 1401,
  W: 2025,
  X: 1407,
  Y: 1243,
  Z: 1407,
  a: 1229,
  b: 1276,
  c: 1067,
  d: 1276,
  e: 1220,
  f: 720,
  g: 1276,
  h: 1296,
  i: 562,
  j: 676,
  k: 1212,
  l: 562,
  m: 1992,
  n: 1296,
  o: 1243,
  p: 1276,
  q: 1276,
  r: 874,
  s: 1067,
  t: 807,
  u: 1296,
  v: 1212,
  w: 1675,
  x: 1212,
  y: 1212,
  z: 1067,
}

const DIGIT_ADVANCE = 1303
const DEFAULT_ADVANCE = 1250
const WIDE =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u3000-\u303F\uFF00-\uFF60\uFFE0-\uFFE6]|\p{Extended_Pictographic}/u
const ZERO_WIDTH = /^[\p{Mn}\p{Me}\p{Cf}]+$/u

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" })

export interface TextMeasureOptions {
  /** Font size in px (default 11). */
  readonly fontSize?: number
  /** Bold text is estimated ~8% wider (default false). */
  readonly bold?: boolean
  /** Extra space added after every character, in px (default 0). */
  readonly letterSpacing?: number
}

function graphemeAdvance(grapheme: string): number {
  const first = grapheme[0] ?? ""
  if (grapheme.length === 1) {
    if (first >= "0" && first <= "9") return DIGIT_ADVANCE
    const known = ADVANCE[first]
    if (known !== undefined) return known
  }
  if (ZERO_WIDTH.test(grapheme)) return 0
  if (WIDE.test(grapheme)) return UNITS_PER_EM
  const base = ADVANCE[first]
  return base ?? DEFAULT_ADVANCE
}

/** Estimated rendered width of `text` in px. */
export function estimateTextWidth(text: string, options: TextMeasureOptions = {}): number {
  const fontSize = options.fontSize ?? 11
  const spacing = options.letterSpacing ?? 0
  let units = 0
  let count = 0
  for (const { segment } of segmenter.segment(text)) {
    const advance = graphemeAdvance(segment)
    units += advance
    if (advance > 0) count += 1
  }
  const width = (units / UNITS_PER_EM) * fontSize * (options.bold === true ? 1.08 : 1)
  return width + spacing * count
}

export interface WrapOptions extends TextMeasureOptions {
  /** Maximum number of lines; overflow is truncated with an ellipsis on the last line. */
  readonly maxLines?: number
  /** Ellipsis appended when text is cut (default "…"). */
  readonly ellipsis?: string
}

export interface WrappedText {
  readonly lines: string[]
  /** True when text was dropped to fit `maxLines` or a word had to be cut. */
  readonly truncated: boolean
}

function graphemes(text: string): string[] {
  return Array.from(segmenter.segment(text), (s) => s.segment)
}

/** Longest prefix of `word` (whole graphemes) that fits in `maxWidth` with `suffix` appended. */
function fitPrefix(
  word: string,
  maxWidth: number,
  suffix: string,
  options: TextMeasureOptions,
): string {
  const parts = graphemes(word)
  let lo = 0
  let hi = parts.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    const candidate = parts.slice(0, mid).join("") + suffix
    if (estimateTextWidth(candidate, options) <= maxWidth) lo = mid
    else hi = mid - 1
  }
  return parts.slice(0, lo).join("")
}

/**
 * Greedy word wrap to `maxWidth` px using {@link estimateTextWidth}. Whitespace
 * runs collapse to single spaces; words longer than a line are broken by
 * grapheme. When `maxLines` is exceeded, the last line ends with the ellipsis.
 *
 * @example
 * ```ts
 * wrapText("The quick brown fox jumps over the lazy dog", 120, { fontSize: 16, maxLines: 2 })
 * // { lines: ["The quick", "brown fox…"], truncated: true }
 * ```
 */
export function wrapText(text: string, maxWidth: number, options: WrapOptions = {}): WrappedText {
  if (!(maxWidth > 0)) throw new RangeError("maxWidth must be positive")
  const maxLines = options.maxLines ?? Number.POSITIVE_INFINITY
  const ellipsis = options.ellipsis ?? "…"
  const words = text.split(/\s+/).filter((word) => word !== "")
  const lines: string[] = []
  let current = ""
  let broke = false
  const fits = (candidate: string): boolean => estimateTextWidth(candidate, options) <= maxWidth

  for (const word of words) {
    const candidate = current === "" ? word : `${current} ${word}`
    if (fits(candidate)) {
      current = candidate
      continue
    }
    if (current !== "") lines.push(current)
    let rest = word
    while (!fits(rest)) {
      const head = fitPrefix(rest, maxWidth, "", options) || (graphemes(rest)[0] ?? "")
      lines.push(head)
      rest = rest.slice(head.length)
      broke = true
    }
    current = rest
  }
  if (current !== "") lines.push(current)

  if (lines.length <= maxLines) return { lines, truncated: broke }
  if (maxLines <= 0) return { lines: [], truncated: true }
  const kept = lines.slice(0, maxLines)
  const lastIndex = kept.length - 1
  const overflow = `${kept[lastIndex] ?? ""} ${lines[maxLines] ?? ""}`
  let fitted = fitPrefix(overflow, maxWidth, ellipsis, options)
  const cutMidWord = fitted.length < overflow.length && !/\s/.test(overflow.charAt(fitted.length))
  const lastSpace = fitted.lastIndexOf(" ")
  // Prefer ending on a word boundary; only cut inside a word when the line is a single word.
  if (cutMidWord && lastSpace > 0) fitted = fitted.slice(0, lastSpace)
  kept[lastIndex] = fitted.trimEnd() + ellipsis
  return { lines: kept, truncated: true }
}
