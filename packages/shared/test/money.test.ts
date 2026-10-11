import { describe, expect, it } from "vitest"
import {
  absMoney,
  add,
  allocate,
  applyBps,
  BPS_PER_WHOLE,
  bpsOf,
  CurrencyMismatchError,
  compareMoney,
  currencyExponent,
  deserializeMoney,
  divideRounded,
  formatMoney,
  fromMajor,
  isNegative,
  isZero,
  money,
  moneyEquals,
  multiply,
  multiplyByRatio,
  negate,
  percentOf,
  serializeMoney,
  subtract,
  sumMoney,
  toMajorString,
  toMinorNumber,
  zero,
} from "../src/money.ts"

const usd = (n: bigint): ReturnType<typeof money> => money(n, "USD")

describe("currencyExponent", () => {
  it("knows minor-unit exponents", () => {
    expect(currencyExponent("USD")).toBe(2)
    expect(currencyExponent("JPY")).toBe(0)
    expect(currencyExponent("KWD")).toBe(3)
  })
  it("rejects invalid codes", () => {
    expect(() => currencyExponent("dollars")).toThrow(RangeError)
  })
})

describe("divideRounded", () => {
  it("implements each rounding mode", () => {
    expect(divideRounded(5n, 2n)).toBe(2n)
    expect(divideRounded(7n, 2n)).toBe(4n)
    expect(divideRounded(-5n, 2n)).toBe(-2n)
    expect(divideRounded(5n, 2n, "half-up")).toBe(3n)
    expect(divideRounded(-5n, 2n, "half-up")).toBe(-3n)
    expect(divideRounded(5n, 2n, "half-down")).toBe(2n)
    expect(divideRounded(7n, 3n, "floor")).toBe(2n)
    expect(divideRounded(-7n, 3n, "floor")).toBe(-3n)
    expect(divideRounded(7n, 3n, "ceil")).toBe(3n)
    expect(divideRounded(-7n, 3n, "ceil")).toBe(-2n)
    expect(divideRounded(-7n, 3n, "trunc")).toBe(-2n)
    expect(divideRounded(6n, 3n, "half-up")).toBe(2n)
  })
  it("handles negative divisors", () => {
    expect(divideRounded(7n, -2n, "half-up")).toBe(-4n)
  })
  it("throws on division by zero", () => {
    expect(() => divideRounded(1n, 0n)).toThrow(RangeError)
  })
})

describe("construction and conversion", () => {
  it("money normalizes the currency", () => {
    expect(money(150, "usd")).toEqual({ amount: 150n, currency: "USD" })
    expect(zero("EUR")).toEqual({ amount: 0n, currency: "EUR" })
  })
  it("rejects unsafe numbers", () => {
    expect(() => money(1.5, "USD")).toThrow(RangeError)
    expect(() => money(Number.MAX_SAFE_INTEGER + 1, "USD")).toThrow(RangeError)
  })
  it("fromMajor parses decimal strings exactly", () => {
    expect(fromMajor("12.34", "USD").amount).toBe(1234n)
    expect(fromMajor("-0.5", "USD").amount).toBe(-50n)
    expect(fromMajor("7", "USD").amount).toBe(700n)
    expect(fromMajor("1500", "JPY").amount).toBe(1500n)
  })
  it("fromMajor refuses excess precision unless asked to round", () => {
    expect(() => fromMajor("1.005", "USD")).toThrow()
    expect(fromMajor("1.005", "USD", "half-even").amount).toBe(100n)
    expect(fromMajor("1.005", "USD", "half-up").amount).toBe(101n)
  })
  it("fromMajor rejects garbage", () => {
    expect(() => fromMajor("1e3", "USD")).toThrow()
    expect(() => fromMajor("", "USD")).toThrow()
    expect(() => fromMajor("1,000", "USD")).toThrow()
  })
  it("toMajorString renders exact decimals", () => {
    expect(toMajorString(usd(-5n))).toBe("-0.05")
    expect(toMajorString(usd(123456n))).toBe("1234.56")
    expect(toMajorString(money(1500n, "JPY"))).toBe("1500")
    expect(toMajorString(money(1n, "KWD"))).toBe("0.001")
  })
  it("toMinorNumber guards precision", () => {
    expect(toMinorNumber(usd(99n))).toBe(99)
    expect(() => toMinorNumber(usd(2n ** 60n))).toThrow(RangeError)
  })
})

describe("arithmetic", () => {
  it("adds, subtracts and sums", () => {
    expect(add(usd(100n), usd(50n)).amount).toBe(150n)
    expect(subtract(usd(100n), usd(150n)).amount).toBe(-50n)
    expect(sumMoney([usd(1n), usd(2n), usd(3n)], "USD").amount).toBe(6n)
    expect(sumMoney([], "USD").amount).toBe(0n)
  })
  it("refuses mixed currencies", () => {
    expect(() => add(usd(1n), money(1n, "EUR"))).toThrow(CurrencyMismatchError)
    expect(() => sumMoney([money(1n, "EUR")], "USD")).toThrow(CurrencyMismatchError)
  })
  it("negates and takes absolute value", () => {
    expect(negate(usd(5n)).amount).toBe(-5n)
    expect(absMoney(usd(-5n)).amount).toBe(5n)
  })
  it("multiplies by ratios and decimal factors", () => {
    expect(multiplyByRatio(usd(10000n), 13, 31).amount).toBe(4194n)
    expect(multiply(usd(1000n), "1.0825").amount).toBe(1082n)
    expect(multiply(usd(1000n), "1.0825", "half-up").amount).toBe(1083n)
    expect(() => multiplyByRatio(usd(1n), 1, 0)).toThrow(RangeError)
  })
  it("works in basis points and percents", () => {
    expect(BPS_PER_WHOLE).toBe(10_000)
    expect(applyBps(usd(10000n), 250).amount).toBe(250n)
    expect(bpsOf(usd(250n), usd(10000n))).toBe(250)
    expect(() => bpsOf(usd(1n), usd(0n))).toThrow()
    expect(percentOf(usd(19999n), "7.25").amount).toBe(1450n)
  })
})

describe("allocate", () => {
  it("never loses or invents a minor unit", () => {
    expect(allocate(usd(100n), [1, 1, 1]).map((m) => m.amount)).toEqual([34n, 33n, 33n])
    expect(allocate(usd(5n), [70, 30]).map((m) => m.amount)).toEqual([4n, 1n])
    expect(allocate(usd(-100n), [1, 1, 1]).map((m) => m.amount)).toEqual([-34n, -33n, -33n])
    expect(allocate(usd(10n), [0, 1]).map((m) => m.amount)).toEqual([0n, 10n])
  })
  it("sum of parts equals the whole across many ratios", () => {
    const parts = allocate(usd(1_000_003n), [3, 7, 11, 13])
    expect(sumMoney(parts, "USD").amount).toBe(1_000_003n)
  })
  it("rejects bad ratios", () => {
    expect(() => allocate(usd(1n), [])).toThrow()
    expect(() => allocate(usd(1n), [0, 0])).toThrow()
    expect(() => allocate(usd(1n), [-1, 2])).toThrow()
  })
})

describe("comparison", () => {
  it("compares and tests", () => {
    expect(compareMoney(usd(1n), usd(2n))).toBe(-1)
    expect(compareMoney(usd(2n), usd(2n))).toBe(0)
    expect(compareMoney(usd(3n), usd(2n))).toBe(1)
    expect(() => compareMoney(usd(1n), money(1n, "EUR"))).toThrow(CurrencyMismatchError)
    expect(moneyEquals(usd(1n), usd(1n))).toBe(true)
    expect(moneyEquals(usd(1n), money(1n, "EUR"))).toBe(false)
    expect(isZero(usd(0n))).toBe(true)
    expect(isNegative(usd(-1n))).toBe(true)
    expect(isNegative(usd(0n))).toBe(false)
  })
})

describe("formatMoney", () => {
  it("formats per locale", () => {
    expect(formatMoney(usd(123456n))).toBe("$1,234.56")
    expect(formatMoney(money(123456n, "EUR"), "de-DE")).toBe("1.234,56 €")
    expect(formatMoney(usd(-500n), "en-US", { currencySign: "accounting" })).toBe("($5.00)")
    expect(formatMoney(money(1500n, "JPY"), "en-US")).toBe("¥1,500")
  })
  it("formats amounts beyond Number precision exactly", () => {
    expect(formatMoney(usd(900719925474099312n))).toBe("$9,007,199,254,740,993.12")
  })
})

describe("serialization", () => {
  it("round-trips", () => {
    const s = serializeMoney(usd(-1234n))
    expect(s).toEqual({ amount: "-1234", currency: "USD" })
    expect(deserializeMoney(JSON.parse(JSON.stringify(s)))).toEqual(usd(-1234n))
  })
  it("rejects malformed amounts", () => {
    expect(() => deserializeMoney({ amount: "12.5", currency: "USD" })).toThrow()
    expect(() => deserializeMoney({ amount: "abc", currency: "USD" })).toThrow()
  })
})
