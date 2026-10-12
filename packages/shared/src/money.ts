/**
 * Exact money arithmetic in integer minor units (`bigint`).
 *
 * A `Money` value is `{ amount, currency }` where `amount` counts the
 * currency's minor unit: cents for USD (exponent 2), yen for JPY (exponent 0),
 * fils for KWD (exponent 3). Floating point never touches an amount, so
 * `0.1 + 0.2` problems cannot occur, and every operation that has to discard
 * precision (ratios, percentages, basis points) takes an explicit
 * {@link RoundingMode} — default `"half-even"` (banker's rounding), which does
 * not bias totals upward over many operations.
 *
 * Minor-unit exponents come from the runtime's `Intl` data
 * (`resolvedOptions().maximumFractionDigits`), so no currency table is
 * hand-maintained here.
 *
 * @example
 * ```ts
 * import { fromMajor, add, applyBps, allocate, formatMoney } from "@bib/shared/money"
 *
 * const price = fromMajor("19.99", "USD")            // { amount: 1999n, currency: "USD" }
 * const fee = applyBps(price, 290)                    // 2.9% → 58n (57.971 rounds half-even)
 * const total = add(price, fee)                       // 2057n
 * allocate(total, [1, 1, 1]).map((m) => m.amount)     // [686n, 686n, 685n] — always sums to 2057n
 * formatMoney(total)                                  // "$20.57"
 * formatMoney(fromMajor("1500", "JPY"), "ja-JP")      // "￥1,500"
 * ```
 */

/** An amount of a currency, in integer minor units. */
export interface Money {
  /** Count of minor units (e.g. cents). May be negative. */
  readonly amount: bigint
  /** ISO 4217 code, upper case, e.g. `"USD"`. */
  readonly currency: string
}

/**
 * How to resolve a result that falls between two representable minor units.
 *
 * - `"half-even"` — ties go to the even neighbour (banker's rounding). Default.
 * - `"half-up"` — ties go away from zero (commercial rounding: 2.5 → 3, -2.5 → -3).
 * - `"half-down"` — ties go toward zero (2.5 → 2, -2.5 → -2).
 * - `"floor"` — always toward negative infinity.
 * - `"ceil"` — always toward positive infinity.
 * - `"trunc"` — always toward zero.
 */
export type RoundingMode = "half-even" | "half-up" | "half-down" | "floor" | "ceil" | "trunc"

/** Thrown when two amounts of different currencies are combined. */
export class CurrencyMismatchError extends Error {
  constructor(a: string, b: string) {
    super(`Currency mismatch: ${a} vs ${b}`)
    this.name = "CurrencyMismatchError"
  }
}

const CURRENCY_CODE = /^[A-Z]{3}$/
const exponentCache = new Map<string, number>()

function normalizeCurrency(currency: string): string {
  const code = currency.toUpperCase()
  if (!CURRENCY_CODE.test(code)) {
    throw new RangeError(`Invalid currency code: ${JSON.stringify(currency)}`)
  }
  return code
}

/**
 * Number of minor-unit digits for `currency`, from the runtime's `Intl` data.
 *
 * @example
 * ```ts
 * currencyExponent("USD") // 2
 * currencyExponent("JPY") // 0
 * currencyExponent("KWD") // 3
 * ```
 */
export function currencyExponent(currency: string): number {
  const code = normalizeCurrency(currency)
  const cached = exponentCache.get(code)
  if (cached !== undefined) return cached
  const digits = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: code,
  }).resolvedOptions().maximumFractionDigits
  const exponent = digits ?? 2
  exponentCache.set(code, exponent)
  return exponent
}

/**
 * Divide `numerator / denominator` rounding per `mode`. The core primitive every
 * lossy operation in this module goes through.
 *
 * @example
 * ```ts
 * divideRounded(5n, 2n, "half-even") // 2n
 * divideRounded(7n, 2n, "half-even") // 4n
 * divideRounded(-5n, 2n, "half-up")  // -3n
 * ```
 */
export function divideRounded(
  numerator: bigint,
  denominator: bigint,
  mode: RoundingMode = "half-even",
): bigint {
  if (denominator === 0n) throw new RangeError("Division by zero")
  if (denominator < 0n) {
    numerator = -numerator
    denominator = -denominator
  }
  const quotient = numerator / denominator // truncates toward zero
  const remainder = numerator % denominator // same sign as numerator
  if (remainder === 0n) return quotient
  const negative = numerator < 0n
  const awayFromZero = negative ? quotient - 1n : quotient + 1n
  const twiceRem = (remainder < 0n ? -remainder : remainder) * 2n
  switch (mode) {
    case "trunc":
      return quotient
    case "floor":
      return negative ? quotient - 1n : quotient
    case "ceil":
      return negative ? quotient : quotient + 1n
    case "half-up":
      return twiceRem >= denominator ? awayFromZero : quotient
    case "half-down":
      return twiceRem > denominator ? awayFromZero : quotient
    case "half-even": {
      if (twiceRem > denominator) return awayFromZero
      if (twiceRem < denominator) return quotient
      return quotient % 2n === 0n ? quotient : awayFromZero
    }
  }
}

/** An exact rational `numerator / denominator` with a positive denominator. */
interface Ratio {
  readonly numerator: bigint
  readonly denominator: bigint
}

const DECIMAL = /^([+-])?(\d+)?(?:\.(\d+))?(?:e([+-]?\d+))?$/i

/**
 * Parse a decimal (string or finite number) into an exact ratio. Numbers are
 * read through their shortest round-trip string, so `1.075` means exactly
 * 1075/1000, not the nearest binary double.
 */
function toRatio(value: string | number | bigint): Ratio {
  if (typeof value === "bigint") return { numerator: value, denominator: 1n }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new RangeError(`Expected a finite number, got ${value}`)
  }
  const text = String(value).trim()
  const m = DECIMAL.exec(text)
  const intPart = m?.[2]
  const fracPart = m?.[3]
  if (!m || (intPart === undefined && fracPart === undefined)) {
    throw new RangeError(`Not a decimal number: ${JSON.stringify(value)}`)
  }
  const sign = m[1] === "-" ? -1n : 1n
  const frac = fracPart ?? ""
  const exp = Number(m[4] ?? "0") - frac.length
  let numerator = BigInt(`${intPart ?? "0"}${frac}`) * sign
  let denominator = 1n
  if (exp >= 0) numerator *= 10n ** BigInt(exp)
  else denominator = 10n ** BigInt(-exp)
  return { numerator, denominator }
}

/**
 * Construct `Money` from an integer count of minor units.
 *
 * @throws RangeError for a non-integer or unsafe `number` amount.
 */
export function money(amount: bigint | number, currency: string): Money {
  const code = normalizeCurrency(currency)
  if (typeof amount === "number") {
    if (!Number.isSafeInteger(amount)) {
      throw new RangeError(`Minor-unit amount must be a safe integer, got ${amount}`)
    }
    return { amount: BigInt(amount), currency: code }
  }
  return { amount, currency: code }
}

/** Zero of `currency`. */
export function zero(currency: string): Money {
  return money(0n, currency)
}

/**
 * Parse a major-unit decimal string ("12.34") into `Money`. When the string has
 * more fraction digits than the currency allows, it throws unless a `rounding`
 * mode is given — silently dropping a fraction of a cent hides bugs.
 *
 * @example
 * ```ts
 * fromMajor("12.34", "USD")                 // 1234n
 * fromMajor("-0.5", "USD")                  // -50n
 * fromMajor("100", "JPY")                   // 100n
 * fromMajor("1.005", "USD", "half-even")    // 100n
 * fromMajor("1.005", "USD")                 // throws RangeError
 * ```
 */
export function fromMajor(value: string, currency: string, rounding?: RoundingMode): Money {
  const exponent = currencyExponent(currency)
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(value.trim())) {
    throw new RangeError(`Not a plain decimal amount: ${JSON.stringify(value)}`)
  }
  const { numerator, denominator } = toRatio(value)
  const scaled = numerator * 10n ** BigInt(exponent)
  if (scaled % denominator !== 0n && rounding === undefined) {
    throw new RangeError(
      `${JSON.stringify(value)} has more precision than ${currency.toUpperCase()} allows (${exponent} decimals); pass a rounding mode`,
    )
  }
  return money(divideRounded(scaled, denominator, rounding ?? "half-even"), currency)
}

/**
 * The exact major-unit decimal string, always with the currency's full number
 * of fraction digits.
 *
 * @example
 * ```ts
 * toMajorString(money(-5n, "USD")) // "-0.05"
 * toMajorString(money(1500n, "JPY")) // "1500"
 * ```
 */
export function toMajorString(value: Money): string {
  const exponent = currencyExponent(value.currency)
  const negative = value.amount < 0n
  const digits = (negative ? -value.amount : value.amount).toString().padStart(exponent + 1, "0")
  const whole = digits.slice(0, digits.length - exponent)
  const frac = digits.slice(digits.length - exponent)
  return `${negative ? "-" : ""}${whole}${exponent > 0 ? `.${frac}` : ""}`
}

/**
 * The amount as a JS `number` of minor units.
 *
 * @throws RangeError when the amount is outside the safe-integer range.
 */
export function toMinorNumber(value: Money): number {
  const n = Number(value.amount)
  if (!Number.isSafeInteger(n)) throw new RangeError("Amount exceeds Number.MAX_SAFE_INTEGER")
  return n
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) throw new CurrencyMismatchError(a.currency, b.currency)
}

/** `a + b`. Throws {@link CurrencyMismatchError} for different currencies. */
export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b)
  return { amount: a.amount + b.amount, currency: a.currency }
}

/** `a - b`. Throws {@link CurrencyMismatchError} for different currencies. */
export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b)
  return { amount: a.amount - b.amount, currency: a.currency }
}

/** Sum a list; an empty list sums to zero of `currency`. */
export function sumMoney(values: readonly Money[], currency: string): Money {
  let total = zero(currency)
  for (const v of values) total = add(total, v)
  return total
}

/** `-value`. */
export function negate(value: Money): Money {
  return { amount: -value.amount, currency: value.currency }
}

/** `|value|`. */
export function absMoney(value: Money): Money {
  return value.amount < 0n ? negate(value) : value
}

/**
 * `value * numerator / denominator`, rounded once at the end. Use this for any
 * exact fractional scaling (pro-rating 13 of 31 days, etc.).
 *
 * @example
 * ```ts
 * multiplyByRatio(money(10000n, "USD"), 13, 31) // 4194n (4193.548… → half-even)
 * ```
 */
export function multiplyByRatio(
  value: Money,
  numerator: bigint | number | string,
  denominator: bigint | number | string,
  rounding: RoundingMode = "half-even",
): Money {
  const n = toRatio(numerator)
  const d = toRatio(denominator)
  if (d.numerator === 0n) throw new RangeError("Division by zero")
  return {
    amount: divideRounded(
      value.amount * n.numerator * d.denominator,
      n.denominator * d.numerator,
      rounding,
    ),
    currency: value.currency,
  }
}

/**
 * `value * factor` where `factor` is a decimal (string recommended for
 * exactness; numbers are read via their shortest round-trip form).
 *
 * @example
 * ```ts
 * multiply(money(1000n, "USD"), "1.0825")             // 1082n (1082.5 is a tie → even neighbour)
 * multiply(money(1000n, "USD"), "1.0825", "half-up")  // 1083n
 * ```
 */
export function multiply(
  value: Money,
  factor: bigint | number | string,
  rounding: RoundingMode = "half-even",
): Money {
  return multiplyByRatio(value, factor, 1n, rounding)
}

/** Basis points in one whole (100% = 10 000 bps). */
export const BPS_PER_WHOLE = 10_000

/**
 * `value * bps / 10 000`. Basis points may be fractional ("12.5").
 *
 * @example
 * ```ts
 * applyBps(money(10_000n, "USD"), 250) // 250n (2.5% of $100.00)
 * ```
 */
export function applyBps(
  value: Money,
  bps: bigint | number | string,
  rounding: RoundingMode = "half-even",
): Money {
  return multiplyByRatio(value, bps, BPS_PER_WHOLE, rounding)
}

/**
 * How many basis points `part` is of `whole`, rounded to an integer.
 *
 * @example
 * ```ts
 * bpsOf(money(250n, "USD"), money(10_000n, "USD")) // 250
 * ```
 * @throws RangeError when `whole` is zero.
 */
export function bpsOf(part: Money, whole: Money, rounding: RoundingMode = "half-even"): number {
  assertSameCurrency(part, whole)
  if (whole.amount === 0n) throw new RangeError("bpsOf: whole is zero")
  return Number(divideRounded(part.amount * BigInt(BPS_PER_WHOLE), whole.amount, rounding))
}

/**
 * `value * percent / 100`.
 *
 * @example
 * ```ts
 * percentOf(money(19_999n, "USD"), "7.25") // 1450n (1449.9275 → 1450)
 * ```
 */
export function percentOf(
  value: Money,
  percent: bigint | number | string,
  rounding: RoundingMode = "half-even",
): Money {
  return multiplyByRatio(value, percent, 100n, rounding)
}

/**
 * Split `value` into parts proportional to `ratios` using the largest-remainder
 * method. The parts ALWAYS sum exactly to `value`: each part starts at its
 * floor share, then the leftover minor units go one each to the parts with the
 * largest fractional remainders (ties broken by position, earlier first).
 * Negative amounts are split by magnitude and negated, so `allocate(-x)` is the
 * mirror image of `allocate(x)`.
 *
 * @example
 * ```ts
 * allocate(money(100n, "USD"), [1, 1, 1]).map((m) => m.amount) // [34n, 33n, 33n]
 * allocate(money(5n, "USD"), [70, 30]).map((m) => m.amount)    // [4n, 1n]  (3.5→4, 1.5→1)
 * ```
 * @throws RangeError for an empty list, a negative ratio, or ratios summing to zero.
 */
export function allocate(value: Money, ratios: readonly (bigint | number | string)[]): Money[] {
  if (ratios.length === 0) throw new RangeError("allocate: ratios must not be empty")
  const parsed = ratios.map(toRatio)
  let common = 1n
  for (const r of parsed) if (r.denominator > common) common = r.denominator
  // All denominators are powers of ten, so the largest one is a common multiple.
  const weights = parsed.map((r) => (r.numerator * common) / r.denominator)
  if (weights.some((w) => w < 0n)) throw new RangeError("allocate: ratios must be non-negative")
  const totalWeight = weights.reduce((a, b) => a + b, 0n)
  if (totalWeight === 0n) throw new RangeError("allocate: ratios must not all be zero")

  const negative = value.amount < 0n
  const total = negative ? -value.amount : value.amount
  const shares = weights.map((w) => (total * w) / totalWeight)
  const remainders = weights.map((w, index) => ({ index, rem: (total * w) % totalWeight }))
  let leftover = total - shares.reduce((a, b) => a + b, 0n)
  remainders.sort((a, b) => (a.rem === b.rem ? a.index - b.index : a.rem > b.rem ? -1 : 1))
  for (const { index } of remainders) {
    if (leftover === 0n) break
    shares[index] = (shares[index] ?? 0n) + 1n
    leftover -= 1n
  }
  return shares.map((s) => ({ amount: negative ? -s : s, currency: value.currency }))
}

/** `-1`, `0`, or `1`. Throws {@link CurrencyMismatchError} for different currencies. */
export function compareMoney(a: Money, b: Money): -1 | 0 | 1 {
  assertSameCurrency(a, b)
  return a.amount < b.amount ? -1 : a.amount > b.amount ? 1 : 0
}

/** Same currency and same amount. Never throws. */
export function moneyEquals(a: Money, b: Money): boolean {
  return a.currency === b.currency && a.amount === b.amount
}

/** Amount is exactly zero. */
export function isZero(value: Money): boolean {
  return value.amount === 0n
}

/** Amount is below zero. */
export function isNegative(value: Money): boolean {
  return value.amount < 0n
}

/** Options for {@link formatMoney}. */
export interface FormatMoneyOptions {
  /** How the currency is shown. Default `"symbol"`. */
  readonly currencyDisplay?: "symbol" | "narrowSymbol" | "code" | "name"
  /** Accounting style shows negatives in parentheses. Default `"standard"`. */
  readonly currencySign?: "standard" | "accounting"
  /** Show `+` for positives (`"exceptZero"`) etc. Default `"auto"`. */
  readonly signDisplay?: "auto" | "always" | "exceptZero" | "never"
}

/**
 * Locale-aware display. The exact decimal string is handed to
 * `Intl.NumberFormat`, so amounts beyond `Number.MAX_SAFE_INTEGER` still print
 * every digit.
 *
 * @example
 * ```ts
 * formatMoney(money(123456n, "USD"))            // "$1,234.56"
 * formatMoney(money(123456n, "EUR"), "de-DE")   // "1.234,56 €"
 * formatMoney(money(-500n, "USD"), "en-US", { currencySign: "accounting" }) // "($5.00)"
 * ```
 */
export function formatMoney(
  value: Money,
  locale = "en-US",
  options: FormatMoneyOptions = {},
): string {
  const exponent = currencyExponent(value.currency)
  const formatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: value.currency,
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
    currencyDisplay: options.currencyDisplay ?? "symbol",
    currencySign: options.currencySign ?? "standard",
    signDisplay: options.signDisplay ?? "auto",
  })
  // Intl.NumberFormat v3 formats an exact decimal string without converting it
  // to a double. toMajorString always yields a valid numeric literal; the lib
  // type models that as a template-literal type, hence the boundary cast.
  return formatter.format(toMajorString(value) as `${number}`)
}

/** JSON-safe form: `bigint` does not serialize with `JSON.stringify`. */
export interface SerializedMoney {
  readonly amount: string
  readonly currency: string
}

/** Convert to a JSON-safe object (amount as a decimal integer string). */
export function serializeMoney(value: Money): SerializedMoney {
  return { amount: value.amount.toString(), currency: value.currency }
}

/** Inverse of {@link serializeMoney}; validates the input. */
export function deserializeMoney(value: SerializedMoney): Money {
  if (!/^-?\d+$/.test(value.amount)) {
    throw new RangeError(`Invalid serialized amount: ${JSON.stringify(value.amount)}`)
  }
  return money(BigInt(value.amount), value.currency)
}
