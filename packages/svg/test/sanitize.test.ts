import { describe, expect, it } from "vitest"
import { decodeCssEscapes, localRefId, sanitizeSvg, utf8ByteLength } from "../src/sanitize.ts"
import { elementsOf, getAttr, parseXml } from "../src/xml.ts"

const NS = 'xmlns="http://www.w3.org/2000/svg"'
const XLINK = 'xmlns:xlink="http://www.w3.org/1999/xlink"'

function clean(body: string, options?: Parameters<typeof sanitizeSvg>[1]): string {
  const result = sanitizeSvg(`<svg ${NS} ${XLINK} viewBox="0 0 10 10">${body}</svg>`, options)
  if (!result.ok) throw new Error(`${result.reason}: ${result.message}`)
  return result.svg
}

function failure(input: string, options?: Parameters<typeof sanitizeSvg>[1]): string {
  const result = sanitizeSvg(input, options)
  if (result.ok) throw new Error(`expected failure, got ${result.svg}`)
  return result.reason
}

/** Markers that must never appear in sanitized output. */
const DANGER =
  /<script|on[a-z]+\s*=|javascript:|vbscript:|data:text|data:image\/svg|foreignObject|<iframe|<style|expression\(|<!ENTITY|<!DOCTYPE|xml-stylesheet/i

describe("sanitizeSvg: allowed content survives", () => {
  it("keeps shapes, gradients, text and local references", () => {
    const out = clean(
      '<defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient></defs>' +
        '<rect width="10" height="10" fill="url(#g)"/><text x="1" y="5">Hi &amp; bye</text>' +
        '<path id="p" d="M0 0L10 10"/><use href="#p"/>',
    )
    expect(out).toContain('fill="url(#g)"')
    expect(out).toContain("Hi &amp; bye")
    expect(out).toContain('<use href="#p"/>')
    expect(out.startsWith(`<svg ${NS}`)).toBe(true)
  })
  it("rewrites xlink:href to href", () => {
    expect(clean('<path id="p" d="M0 0"/><use xlink:href="#p"/>')).toContain('<use href="#p"/>')
  })
  it("is idempotent", () => {
    const once = clean('<g fill="#000"><circle r="2"/><text>a</text></g>')
    const twice = sanitizeSvg(once)
    expect(twice.ok && twice.svg).toBe(once)
  })
})

describe("sanitizeSvg: XSS vectors", () => {
  const vectors: [string, string][] = [
    ["script element", "<script>alert(1)</script>"],
    ["script with CDATA", "<script><![CDATA[alert(1)]]></script>"],
    ["onload handler", '<rect width="1" height="1" onload="alert(1)"/>'],
    ["mixed-case handler", '<rect width="1" height="1" OnClIcK="alert(1)"/>'],
    ["namespaced handler", '<rect width="1" height="1" xlink:onclick="alert(1)"/>'],
    ["anchor javascript href", '<a href="javascript:alert(1)"><text>x</text></a>'],
    ["use javascript href", '<use href="javascript:alert(1)"/>'],
    ["entity-obfuscated scheme", '<use href="jav&#x09;ascript:alert(1)"/>'],
    ["decimal-entity scheme", '<use href="&#106;avascript:alert(1)"/>'],
    ["upper-case scheme", '<use href=" JaVaScRiPt:alert(1)"/>'],
    ["vbscript", '<use href="vbscript:msgbox(1)"/>'],
    ["external href", '<use href="https://evil.example/sprite.svg#x"/>'],
    ["svg data uri in use", '<use href="data:image/svg+xml;base64,PHN2Zy8+#x"/>'],
    ["foreignObject", "<foreignObject><iframe src='javascript:alert(1)'/></foreignObject>"],
    ["style element", "<style>@import url(https://evil.example/x.css)</style>"],
    ["style url()", '<rect width="1" height="1" style="fill:url(https://evil.example/x)"/>'],
    [
      "style escaped url",
      '<rect width="1" height="1" style="fill:\\75rl(https://evil.example/x)"/>',
    ],
    [
      "style comment-split url",
      '<rect width="1" height="1" style="fill:u/**/rl(https://evil.example/x)"/>',
    ],
    ["style expression", '<rect width="1" height="1" style="width:expression(alert(1))"/>'],
    ["fill external url", '<rect width="1" height="1" fill="url(https://evil.example/#g)"/>'],
    ["animate to javascript", '<a><animate attributeName="href" to="javascript:alert(1)"/></a>'],
    ["set handler", '<set attributeName="onload" to="alert(1)"/>'],
    ["iframe", "<iframe src='javascript:alert(1)'/>"],
    ["feImage external", '<filter id="f"><feImage href="https://evil.example/x.png"/></filter>'],
    [
      "image svg data uri",
      '<image href="data:image/svg+xml;base64,PHN2Zz48c2NyaXB0Lz48L3N2Zz4=" width="1" height="1"/>',
    ],
    [
      "image text/html data uri",
      '<image href="data:text/html,<script>alert(1)</script>" width="1" height="1"/>',
    ],
    ["comment smuggling", "<!-- <script>alert(1)</script> --><rect width='1' height='1'/>"],
    ["processing instruction", '<?php echo 1 ?><rect width="1" height="1"/>'],
  ]

  it.each(vectors)("neutralizes %s", (_label, body) => {
    const result = sanitizeSvg(`<svg ${NS} ${XLINK}>${body}</svg>`)
    if (result.ok) {
      expect(result.svg).not.toMatch(DANGER)
      expect(result.svg).not.toMatch(/evil\.example/)
    } else {
      expect(result.svg).toBeNull()
    }
  })

  it("keeps the label text but escapes the injected quote", () => {
    const out = clean(
      '<g aria-label="x&quot; onload=&quot;alert(1)"><rect width="1" height="1"/></g>',
    )
    const parsed = parseXml(out)
    const g = parsed.ok ? elementsOf(elementsOf(parsed.nodes)[0]?.children ?? [])[0] : undefined
    expect(g?.attrs.map((attr) => attr.name)).toEqual(["aria-label"])
    expect(g && getAttr(g, "aria-label")).toBe('x" onload="alert(1)')
  })

  it("records what it removed", () => {
    const result = sanitizeSvg(
      `<svg ${NS}><script>x</script><rect width="1" height="1" onclick="x"/></svg>`,
    )
    expect(result.ok).toBe(true)
    expect(result.removed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "element", name: "script", reason: "not-allowed" }),
        expect.objectContaining({ kind: "attribute", name: "onclick", reason: "event-handler" }),
      ]),
    )
  })
})

describe("sanitizeSvg: rejected documents", () => {
  it("rejects DOCTYPE and entity declarations", () => {
    expect(failure(`<!DOCTYPE svg [<!ENTITY x "y">]><svg ${NS}>&x;</svg>`)).toBe("declaration")
  })
  it("rejects xml-stylesheet processing instructions", () => {
    expect(failure(`<?xml-stylesheet href="https://evil.example/x.css"?><svg ${NS}/>`)).toBe(
      "stylesheet",
    )
  })
  it("rejects oversize input before parsing", () => {
    expect(failure(`<svg ${NS}>${"a".repeat(2000)}</svg>`, { maxBytes: 1000 })).toBe("too-large")
  })
  it("rejects malformed XML", () => {
    expect(failure(`<svg ${NS}><g></svg>`)).toBe("malformed")
  })
  it("rejects a non-svg root and multiple roots", () => {
    expect(failure("<html/>")).toBe("root")
    expect(failure(`<svg ${NS}/><svg ${NS}/>`)).toBe("root")
  })
  it("rejects deep nesting", () => {
    expect(failure(`<svg ${NS}>${"<g>".repeat(200)}${"</g>".repeat(200)}</svg>`)).toBe("too-deep")
  })
  it("rejects too many nodes", () => {
    expect(failure(`<svg ${NS}>${"<g/>".repeat(100)}</svg>`, { maxNodes: 50 })).toBe(
      "too-many-nodes",
    )
  })
  it("rejects a <use> cycle", () => {
    expect(
      failure(`<svg ${NS}><g id="a"><use href="#b"/></g><g id="b"><use href="#a"/></g></svg>`),
    ).toBe("use-cycle")
  })
  it("rejects exponential <use> expansion", () => {
    let defs = '<g id="l0"><rect width="1" height="1"/></g>'
    for (let i = 1; i <= 12; i += 1) {
      defs += `<g id="l${i}">${`<use href="#l${i - 1}"/>`.repeat(10)}</g>`
    }
    expect(failure(`<svg ${NS}><defs>${defs}</defs><use href="#l12"/></svg>`)).toBe("use-expansion")
  })
  it("rejects geometry over budget", () => {
    const d = `M0 0${" L1 1".repeat(500)}`
    expect(failure(`<svg ${NS}><path d="${d}"/></svg>`, { maxGeometryBytes: 100 })).toBe(
      "geometry-budget",
    )
  })
})

describe("sanitizeSvg: reference integrity", () => {
  it("drops duplicate ids after the first", () => {
    const result = sanitizeSvg(
      `<svg ${NS}><rect id="a" width="1" height="1"/><circle id="a" r="1"/></svg>`,
    )
    expect(result.ok && result.svg).toBe(
      `<svg ${NS}><rect id="a" width="1" height="1"/><circle r="1"/></svg>`,
    )
    expect(result.removed).toContainEqual(expect.objectContaining({ reason: "duplicate-id" }))
  })
  it("removes <use> elements whose target is gone", () => {
    const out = clean('<use href="#missing"/><rect width="1" height="1"/>')
    expect(out).not.toContain("<use")
  })
  it("removes a reference that pointed at a removed element", () => {
    const out = clean('<foreignObject id="f"/><use href="#f"/>')
    expect(out).not.toContain("<use")
  })
  it("drops attribute references to unknown ids", () => {
    expect(clean('<rect width="1" height="1" fill="url(#nope)"/>')).not.toContain("fill=")
  })
  it("drops invalid ids", () => {
    expect(clean('<rect id="1 bad" width="1" height="1"/>')).not.toContain("id=")
  })
  it("drops out-of-range coordinates", () => {
    expect(clean('<rect width="1e9" height="1"/>')).not.toContain("width=")
  })
})

describe("sanitizeSvg: stray content", () => {
  it("drops unknown elements with their subtree and comments", () => {
    const out = clean("<blink><rect width='1' height='1'/></blink><!-- note --><circle r='1'/>")
    expect(out).toBe(`<svg ${NS} viewBox="0 0 10 10"><circle r="1"/></svg>`)
  })
  it("drops text that is not inside a text element", () => {
    expect(clean("hello<circle r='1'/>")).not.toContain("hello")
  })
})

describe("sanitizeSvg: raster images", () => {
  const png = "data:image/png;base64,iVBORw0KGgo="
  it("drops <image> by default", () => {
    expect(clean(`<image href="${png}" width="1" height="1"/>`)).not.toContain("<image")
  })
  it("keeps a raster data URI when allowImages is set", () => {
    expect(clean(`<image href="${png}" width="1" height="1"/>`, { allowImages: true })).toContain(
      png,
    )
  })
  it("still drops svg+xml and remote images when allowImages is set", () => {
    const svgUri = "data:image/svg+xml;base64,PHN2Zy8+"
    expect(
      clean(`<image href="${svgUri}" width="1" height="1"/>`, { allowImages: true }),
    ).not.toContain("data:")
    expect(
      clean('<image href="https://x.example/a.png" width="1" height="1"/>', { allowImages: true }),
    ).not.toContain("x.example")
  })
})

describe("helpers", () => {
  it("measures UTF-8 bytes", () => {
    expect(utf8ByteLength("aé😀")).toBe(1 + 2 + 4)
  })
  it("decodes CSS escapes and comments", () => {
    expect(decodeCssEscapes("\\75 rl(x)")).toBe("url(x)")
    expect(decodeCssEscapes("u/**/rl")).toBe("url")
  })
  it("extracts local reference ids", () => {
    expect(localRefId("#a")).toBe("a")
    expect(localRefId(" #a ")).toBe("a")
    expect(localRefId("url(#a)")).toBeNull()
    expect(localRefId("#bad id")).toBeNull()
    expect(localRefId("https://x/#a")).toBeNull()
  })
})
