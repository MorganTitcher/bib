/**
 * RFC 4180 CSV encoding and parsing.
 *
 * Encoding: fields containing a comma, double quote, CR, or LF are quoted;
 * embedded quotes are doubled; rows are joined with CRLF (the RFC terminator,
 * and the one Excel and Google Sheets expect).
 *
 * Formula-injection hardening is ON by default. A spreadsheet treats a cell as
 * a formula when its first meaningful character is `=`, `+`, `-`, or `@` (and
 * skips leading TAB/CR/LF before checking), so a user-supplied string like
 * `=HYPERLINK("https://evil.example", "click")` would execute when the export is
 * opened. Such string fields are prefixed with `'`, the OWASP-recommended
 * neutralizer. Numbers are never prefixed, so `-42` stays a number. Disable
 * only for machine-to-machine exports.
 *
 * Parsing accepts CRLF, LF, or CR line endings, quoted fields spanning lines,
 * and an optional UTF-8 BOM. It is strict about malformed quoting and reports
 * the line number.
 *
 * @example
 * ```ts
 * import { toCsv, parseCsv } from "@bib/shared/csv"
 *
 * const text = toCsv(["name", "note"], [["Ada", 'said "hi", left'], ["Eve", "=1+1"]])
 * // 'name,note\r\nAda,"said ""hi"", left"\r\nEve,\'=1+1'
 * parseCsv(text) // [["name","note"],["Ada",'said "hi", left'],["Eve","'=1+1"]]
 * ```
 */

/** One cell. Nullish serializes as an empty field. */
export type CsvCell = string | number | bigint | boolean | null | undefined

/** Options for encoding. */
export interface CsvEncodeOptions {
  /** Neutralize spreadsheet formulas in string cells. Default true. */
  readonly sanitizeFormulas?: boolean
  /** Prepend a UTF-8 BOM so Excel detects UTF-8. Default false. */
  readonly bom?: boolean
  /** Field delimiter. Default `","`. Must be a single character other than `"`, CR, LF. */
  readonly delimiter?: string
}

const FORMULA_LEAD = /^[\t\r\n]*[=+\-@]/
const BOM = "﻿"

function checkDelimiter(delimiter: string): void {
  if (delimiter.length !== 1 || delimiter === '"' || delimiter === "\r" || delimiter === "\n") {
    throw new RangeError(`Invalid CSV delimiter: ${JSON.stringify(delimiter)}`)
  }
}

/** Encode a single field. */
export function escapeCsvField(value: CsvCell, options: CsvEncodeOptions = {}): string {
  if (value === null || value === undefined) return ""
  const delimiter = options.delimiter ?? ","
  let text = String(value)
  if ((options.sanitizeFormulas ?? true) && typeof value === "string" && FORMULA_LEAD.test(text)) {
    text = `'${text}`
  }
  if (text.includes(delimiter) || /["\r\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`
  }
  return text
}

/** Encode one row (no terminator). */
export function toCsvRow(cells: readonly CsvCell[], options: CsvEncodeOptions = {}): string {
  checkDelimiter(options.delimiter ?? ",")
  return cells.map((c) => escapeCsvField(c, options)).join(options.delimiter ?? ",")
}

/**
 * Encode a header row plus data rows. Short rows are padded with empty fields;
 * long rows keep their extra fields (never silently drop data).
 */
export function toCsv(
  headers: readonly CsvCell[],
  rows: readonly (readonly CsvCell[])[],
  options: CsvEncodeOptions = {},
): string {
  const lines = [toCsvRow(headers, options)]
  for (const row of rows) {
    const padded =
      row.length >= headers.length
        ? row
        : [...row, ...Array.from({ length: headers.length - row.length }, () => "")]
    lines.push(toCsvRow(padded, options))
  }
  const body = lines.join("\r\n")
  return options.bom ? BOM + body : body
}

/**
 * Encode an array of objects; columns come from `columns` (order preserved)
 * or, if omitted, from the keys of the first object.
 */
export function objectsToCsv<T extends Record<string, CsvCell>>(
  records: readonly T[],
  columns?: readonly (keyof T & string)[],
  options: CsvEncodeOptions = {},
): string {
  const first = records[0]
  const cols: readonly string[] = columns ?? (first ? Object.keys(first) : [])
  return toCsv(
    cols,
    records.map((r) => cols.map((c) => r[c])),
    options,
  )
}

/** Thrown for malformed CSV input. */
export class CsvParseError extends Error {
  readonly line: number
  constructor(message: string, line: number) {
    super(`${message} (line ${line})`)
    this.name = "CsvParseError"
    this.line = line
  }
}

/** Options for parsing. */
export interface CsvParseOptions {
  readonly delimiter?: string
  /** Drop rows whose every field is empty. Default false. */
  readonly skipEmptyLines?: boolean
}

/**
 * Parse CSV text into rows of strings. A trailing newline does not produce an
 * extra empty row. Values are returned verbatim — the `'` formula guard added
 * by {@link toCsv} is not stripped, because the parser cannot know whether it
 * was added or authored.
 *
 * @throws CsvParseError on an unterminated quoted field or text after a closing quote.
 */
export function parseCsv(text: string, options: CsvParseOptions = {}): string[][] {
  const delimiter = options.delimiter ?? ","
  checkDelimiter(delimiter)
  const input = text.startsWith(BOM) ? text.slice(1) : text
  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let line = 1
  let i = 0
  let quoted = false
  let fieldStarted = false

  const endRow = (): void => {
    row.push(field)
    if (!(options.skipEmptyLines && row.every((f) => f === ""))) rows.push(row)
    row = []
    field = ""
    fieldStarted = false
  }

  while (i < input.length) {
    const ch = input[i]
    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        quoted = false
        i++
        const next = input[i]
        if (next !== undefined && next !== delimiter && next !== "\r" && next !== "\n") {
          throw new CsvParseError("Unexpected character after closing quote", line)
        }
        continue
      }
      if (ch === "\n" || (ch === "\r" && input[i + 1] !== "\n")) line++
      field += ch
      i++
      continue
    }
    if (ch === '"') {
      if (fieldStarted && field !== "") {
        throw new CsvParseError("Quote inside an unquoted field", line)
      }
      quoted = true
      fieldStarted = true
      i++
    } else if (ch === delimiter) {
      row.push(field)
      field = ""
      fieldStarted = false
      i++
    } else if (ch === "\r" || ch === "\n") {
      endRow()
      line++
      i += ch === "\r" && input[i + 1] === "\n" ? 2 : 1
    } else {
      field += ch
      fieldStarted = true
      i++
    }
  }
  if (quoted) throw new CsvParseError("Unterminated quoted field", line)
  if (fieldStarted || field !== "" || row.length > 0) endRow()
  return rows
}

/**
 * Parse CSV whose first row is a header into objects keyed by header name.
 * Missing trailing fields become `""`; extra fields are ignored.
 *
 * @throws CsvParseError on duplicate header names.
 */
export function parseCsvObjects(
  text: string,
  options: CsvParseOptions = {},
): Record<string, string>[] {
  const [header, ...rows] = parseCsv(text, options)
  if (!header) return []
  if (new Set(header).size !== header.length) throw new CsvParseError("Duplicate header", 1)
  return rows.map((r) => Object.fromEntries(header.map((h, idx) => [h, r[idx] ?? ""])))
}
