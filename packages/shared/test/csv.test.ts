import { describe, expect, it } from "vitest"
import {
  CsvParseError,
  escapeCsvField,
  objectsToCsv,
  parseCsv,
  parseCsvObjects,
  toCsv,
  toCsvRow,
} from "../src/csv.ts"

describe("escapeCsvField", () => {
  it("quotes only when needed", () => {
    expect(escapeCsvField("plain")).toBe("plain")
    expect(escapeCsvField("a,b")).toBe('"a,b"')
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""')
    expect(escapeCsvField("line\nbreak")).toBe('"line\nbreak"')
    expect(escapeCsvField(null)).toBe("")
    expect(escapeCsvField(undefined)).toBe("")
    expect(escapeCsvField(12n)).toBe("12")
    expect(escapeCsvField(false)).toBe("false")
  })

  it("guards spreadsheet formulas in strings by default", () => {
    expect(escapeCsvField("=SUM(A1)")).toBe("'=SUM(A1)")
    expect(escapeCsvField("@cmd")).toBe("'@cmd")
    expect(escapeCsvField("\t=1")).toBe("'\t=1")
    expect(escapeCsvField("=1", { sanitizeFormulas: false })).toBe("=1")
  })

  it("leaves negative numbers alone", () => {
    expect(escapeCsvField(-5)).toBe("-5")
  })
})

describe("toCsv", () => {
  it("joins rows with CRLF and pads short rows", () => {
    expect(toCsv(["a", "b"], [[1, "x,y"], [2, undefined], [3]])).toBe('a,b\r\n1,"x,y"\r\n2,\r\n3,')
  })
  it("supports a BOM and custom delimiter", () => {
    expect(toCsv(["a", "b"], [[1, 2]], { bom: true, delimiter: ";" })).toBe("﻿a;b\r\n1;2")
  })
  it("rejects invalid delimiters", () => {
    expect(() => toCsvRow(["a"], { delimiter: '"' })).toThrow(RangeError)
    expect(() => toCsvRow(["a"], { delimiter: ",," })).toThrow(RangeError)
  })
  it("objectsToCsv picks columns", () => {
    expect(objectsToCsv([{ id: 1, name: "A" }], ["name"])).toBe("name\r\nA")
    expect(objectsToCsv([{ id: 1, name: "A" }])).toBe("id,name\r\n1,A")
  })
})

describe("parseCsv", () => {
  it("parses quoted fields, escaped quotes and embedded newlines", () => {
    expect(parseCsv('a,b\r\n"x,1","say ""hi"""\n"multi\nline",z')).toEqual([
      ["a", "b"],
      ["x,1", 'say "hi"'],
      ["multi\nline", "z"],
    ])
  })
  it("strips a BOM and ignores a trailing newline", () => {
    expect(parseCsv("﻿a,b\n1,2\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ])
  })
  it("handles empty fields and empty input", () => {
    expect(parseCsv(",,")).toEqual([["", "", ""]])
    expect(parseCsv("")).toEqual([])
  })
  it("optionally skips empty lines", () => {
    expect(parseCsv("a\n\nb", { skipEmptyLines: true })).toEqual([["a"], ["b"]])
  })
  it("round-trips toCsv output", () => {
    const rows = [
      ["id", "note"],
      ["1", 'a "quoted", multi\nline value'],
    ]
    const header = rows[0] ?? []
    expect(parseCsv(toCsv(header, rows.slice(1), { sanitizeFormulas: false }))).toEqual(rows)
  })
  it("reports malformed input with a line number", () => {
    expect(() => parseCsv('a,"b')).toThrow(CsvParseError)
    expect(() => parseCsv('"a"x')).toThrow("Unexpected character after closing quote")
    expect(() => parseCsv('ok\na"b')).toThrow("(line 2)")
  })
})

describe("parseCsvObjects", () => {
  it("maps rows to header keys", () => {
    expect(parseCsvObjects("id,name\n1,A\n2")).toEqual([
      { id: "1", name: "A" },
      { id: "2", name: "" },
    ])
  })
  it("rejects duplicate headers", () => {
    expect(() => parseCsvObjects("a,a\n1,2")).toThrow()
  })
  it("returns [] for empty input", () => {
    expect(parseCsvObjects("")).toEqual([])
  })
})
