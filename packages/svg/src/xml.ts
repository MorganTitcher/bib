/**
 * A small, strict, non-validating XML parser for SVG documents.
 *
 * Internal building block for the sanitizer and the BIMI checks. It is
 * deliberately strict: anything a browser might interpret differently from
 * this parser (unknown entities, unquoted or duplicated attributes, `<` inside
 * an attribute value, mismatched tags, document type declarations) is a parse
 * error rather than something to guess about. Parsing never resolves external
 * resources and never expands entities beyond the five predefined ones and
 * numeric character references.
 */
import { isXmlChar } from "@bib/shared/xml"

/** An attribute in source order, with its value entity-decoded and normalized. */
export interface XmlAttr {
  readonly name: string
  readonly value: string
}

export interface XmlElement {
  readonly type: "element"
  readonly name: string
  readonly attrs: XmlAttr[]
  readonly children: XmlNode[]
}

export interface XmlText {
  readonly type: "text"
  readonly value: string
}

export interface XmlCdata {
  readonly type: "cdata"
  readonly value: string
}

export interface XmlComment {
  readonly type: "comment"
  readonly value: string
}

export interface XmlProcessingInstruction {
  readonly type: "pi"
  readonly target: string
  readonly value: string
}

export type XmlNode = XmlElement | XmlText | XmlCdata | XmlComment | XmlProcessingInstruction

export type XmlErrorCode = "malformed" | "declaration" | "too-deep" | "too-many-nodes"

export interface XmlError {
  readonly code: XmlErrorCode
  readonly message: string
  readonly offset: number
}

export type XmlParseResult =
  | { readonly ok: true; readonly nodes: XmlNode[] }
  | { readonly ok: false; readonly error: XmlError }

export interface XmlParseOptions {
  /** Maximum element nesting depth (default 100). */
  readonly maxDepth?: number
  /** Maximum number of nodes of any kind (default 100 000). */
  readonly maxNodes?: number
}

class ParseFailure extends Error {
  readonly code: XmlErrorCode
  readonly offset: number
  constructor(code: XmlErrorCode, message: string, offset: number) {
    super(message)
    this.code = code
    this.offset = offset
  }
}

const NAME_START = /[A-Za-z_:]/
const NAME_CHAR = /[A-Za-z0-9_:.-]/
const WS = /[ \t\r\n]/

const PREDEFINED: Readonly<Record<string, string>> = {
  lt: "<",
  gt: ">",
  amp: "&",
  quot: '"',
  apos: "'",
}

function decodeReferences(raw: string, offset: number): string {
  if (!raw.includes("&")) return raw
  return raw.replace(/&([^;&\s]*);?/g, (match, body: string, index: number) => {
    if (!match.endsWith(";")) {
      throw new ParseFailure("malformed", "unterminated entity reference", offset + index)
    }
    const named = PREDEFINED[body]
    if (named !== undefined) return named
    let cp: number
    if (/^#x[0-9A-Fa-f]{1,6}$/.test(body)) cp = Number.parseInt(body.slice(2), 16)
    else if (/^#[0-9]{1,7}$/.test(body)) cp = Number.parseInt(body.slice(1), 10)
    else throw new ParseFailure("malformed", `unknown entity &${body};`, offset + index)
    if (!isXmlChar(cp)) {
      throw new ParseFailure("malformed", `illegal character reference &${body};`, offset + index)
    }
    return String.fromCodePoint(cp)
  })
}

/**
 * Parse `input` into a forest of nodes. Never throws; failures are returned
 * with a code and a source offset.
 */
export function parseXml(input: string, options: XmlParseOptions = {}): XmlParseResult {
  const maxDepth = options.maxDepth ?? 100
  const maxNodes = options.maxNodes ?? 100_000
  try {
    return { ok: true, nodes: new Parser(input, maxDepth, maxNodes).parse() }
  } catch (error) {
    if (error instanceof ParseFailure) {
      return {
        ok: false,
        error: { code: error.code, message: error.message, offset: error.offset },
      }
    }
    throw error
  }
}

class Parser {
  private pos = 0
  private nodeCount = 0
  private readonly s: string
  private readonly maxDepth: number
  private readonly maxNodes: number

  constructor(s: string, maxDepth: number, maxNodes: number) {
    this.s = s
    this.maxDepth = maxDepth
    this.maxNodes = maxNodes
  }

  parse(): XmlNode[] {
    const root: XmlNode[] = []
    const stack: { name: string; children: XmlNode[]; start: number }[] = []
    const current = (): XmlNode[] => stack[stack.length - 1]?.children ?? root
    const s = this.s
    while (this.pos < s.length) {
      const start = this.pos
      if (s.startsWith("<!--", start)) {
        const end = s.indexOf("-->", start + 4)
        if (end === -1) this.fail("malformed", "unterminated comment", start)
        const value = s.slice(start + 4, end)
        if (value.includes("--")) this.fail("malformed", "'--' inside comment", start)
        this.add(current(), { type: "comment", value })
        this.pos = end + 3
      } else if (s.startsWith("<![CDATA[", start)) {
        if (stack.length === 0) this.fail("malformed", "CDATA outside the root element", start)
        const end = s.indexOf("]]>", start + 9)
        if (end === -1) this.fail("malformed", "unterminated CDATA section", start)
        this.add(current(), { type: "cdata", value: s.slice(start + 9, end) })
        this.pos = end + 3
      } else if (s.startsWith("<!", start)) {
        this.fail("declaration", "markup declarations (DOCTYPE, ENTITY) are not supported", start)
      } else if (s.startsWith("<?", start)) {
        const end = s.indexOf("?>", start + 2)
        if (end === -1) this.fail("malformed", "unterminated processing instruction", start)
        const body = s.slice(start + 2, end)
        const target = /^[A-Za-z_:][A-Za-z0-9_:.-]*/.exec(body)?.[0] ?? ""
        if (target === "") this.fail("malformed", "processing instruction without a target", start)
        this.add(current(), { type: "pi", target, value: body.slice(target.length).trim() })
        this.pos = end + 2
      } else if (s.startsWith("</", start)) {
        this.pos = start + 2
        const name = this.readName()
        this.skipWs()
        if (s[this.pos] !== ">") this.fail("malformed", `expected '>' after </${name}`, this.pos)
        this.pos += 1
        const open = stack.pop()
        if (open === undefined) this.fail("malformed", `unexpected closing tag </${name}>`, start)
        if (open.name !== name) {
          this.fail("malformed", `mismatched closing tag </${name}> for <${open.name}>`, start)
        }
      } else if (s[start] === "<") {
        this.pos = start + 1
        const name = this.readName()
        const attrs = this.readAttrs()
        const selfClosing = s.startsWith("/>", this.pos)
        if (selfClosing) this.pos += 2
        else if (s[this.pos] === ">") this.pos += 1
        else this.fail("malformed", `expected '>' to close <${name}`, this.pos)
        const element: XmlElement = { type: "element", name, attrs, children: [] }
        this.add(current(), element)
        if (!selfClosing) {
          if (stack.length + 1 > this.maxDepth) {
            this.fail("too-deep", `nesting exceeds ${this.maxDepth} levels`, start)
          }
          stack.push({ name, children: element.children, start })
        }
      } else {
        const next = s.indexOf("<", start)
        const end = next === -1 ? s.length : next
        const rawText = s.slice(start, end)
        if (rawText.includes("]]>")) this.fail("malformed", "']]>' in character data", start)
        const value = decodeReferences(rawText, start)
        if (stack.length === 0) {
          if (value.trim() !== "") this.fail("malformed", "text outside the root element", start)
        } else {
          this.add(current(), { type: "text", value })
        }
        this.pos = end
      }
    }
    const unclosed = stack[stack.length - 1]
    if (unclosed !== undefined)
      this.fail("malformed", `unclosed <${unclosed.name}>`, unclosed.start)
    return root
  }

  private add(target: XmlNode[], node: XmlNode): void {
    this.nodeCount += 1
    if (this.nodeCount > this.maxNodes) {
      this.fail("too-many-nodes", `more than ${this.maxNodes} nodes`, this.pos)
    }
    target.push(node)
  }

  private fail(code: XmlErrorCode, message: string, offset: number): never {
    throw new ParseFailure(code, message, offset)
  }

  private skipWs(): boolean {
    const begin = this.pos
    while (this.pos < this.s.length && WS.test(this.s[this.pos] ?? "")) this.pos += 1
    return this.pos > begin
  }

  private readName(): string {
    const s = this.s
    const begin = this.pos
    if (!NAME_START.test(s[begin] ?? "")) this.fail("malformed", "expected a name", begin)
    this.pos += 1
    while (this.pos < s.length && NAME_CHAR.test(s[this.pos] ?? "")) this.pos += 1
    return s.slice(begin, this.pos)
  }

  private readAttrs(): XmlAttr[] {
    const s = this.s
    const attrs: XmlAttr[] = []
    const seen = new Set<string>()
    for (;;) {
      const hadWs = this.skipWs()
      const ch = s[this.pos]
      if (ch === undefined) this.fail("malformed", "unexpected end of input in tag", this.pos)
      if (ch === ">" || s.startsWith("/>", this.pos)) return attrs
      if (!hadWs) this.fail("malformed", "attributes must be separated by whitespace", this.pos)
      const nameAt = this.pos
      const name = this.readName()
      this.skipWs()
      if (s[this.pos] !== "=") this.fail("malformed", `attribute ${name} has no value`, this.pos)
      this.pos += 1
      this.skipWs()
      const quote = s[this.pos]
      if (quote !== '"' && quote !== "'") {
        this.fail("malformed", `attribute ${name} value must be quoted`, this.pos)
      }
      const valueStart = this.pos + 1
      const end = s.indexOf(quote, valueStart)
      if (end === -1) this.fail("malformed", `unterminated value for ${name}`, this.pos)
      const rawValue = s.slice(valueStart, end)
      if (rawValue.includes("<")) this.fail("malformed", `'<' in value of ${name}`, valueStart)
      if (seen.has(name)) this.fail("malformed", `duplicate attribute ${name}`, nameAt)
      seen.add(name)
      // Attribute-value normalization: literal whitespace becomes a space,
      // character references are kept as the character they name.
      const normalized = rawValue.replace(/[\t\n\r]/g, " ")
      attrs.push({ name, value: decodeReferences(normalized, valueStart) })
      this.pos = end + 1
    }
  }
}

/** Collect the element nodes from a forest (skipping text, comments and PIs). */
export function elementsOf(nodes: readonly XmlNode[]): XmlElement[] {
  return nodes.filter((node): node is XmlElement => node.type === "element")
}

/** Value of attribute `name` on `element`, or `undefined`. */
export function getAttr(element: XmlElement, name: string): string | undefined {
  return element.attrs.find((attr) => attr.name === name)?.value
}
