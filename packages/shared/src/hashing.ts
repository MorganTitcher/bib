/**
 * Deterministic serialization and SHA-256 content hashing via Web Crypto
 * (`crypto.subtle`), available in Node 20+, browsers, and edge runtimes.
 *
 * {@link stableStringify} sorts object keys recursively, so two objects that are
 * equal as data hash identically regardless of key insertion order — the basis
 * for content addressing, cache keys, idempotency keys, and change detection.
 *
 * @example
 * ```ts
 * import { sha256, stableStringify, contentHash } from "@bib/shared/hashing"
 *
 * await sha256("abc")
 * // "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
 * stableStringify({ b: 1, a: [2, { d: 3, c: 4 }] }) // '{"a":[2,{"c":4,"d":3}],"b":1}'
 * (await contentHash({ a: 1, b: 2 })) === (await contentHash({ b: 2, a: 1 })) // true
 * ```
 */

/** Values {@link stableStringify} accepts. */
export type StableValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly StableValue[]
  | { readonly [key: string]: StableValue }

// Array.isArray does not narrow `readonly T[]` out of a union; this guard does.
function isStableArray(v: StableValue): v is readonly StableValue[] {
  return Array.isArray(v)
}

/**
 * JSON with recursively sorted object keys. Follows `JSON.stringify` semantics
 * for edge cases: `undefined` object properties are omitted, `undefined` array
 * items become `null`. Non-finite numbers throw (JSON would silently write
 * `null`, which would make `NaN` and `null` hash the same). Cycles throw.
 */
export function stableStringify(value: StableValue): string {
  const seen = new Set<object>()
  const walk = (v: StableValue): string | undefined => {
    if (v === undefined) return undefined
    if (v === null) return "null"
    if (typeof v === "number") {
      if (!Number.isFinite(v)) throw new TypeError(`Cannot hash non-finite number: ${v}`)
      return JSON.stringify(v)
    }
    if (typeof v === "string" || typeof v === "boolean") return JSON.stringify(v)
    if (seen.has(v)) throw new TypeError("Cannot stringify a circular structure")
    seen.add(v)
    let out: string
    if (isStableArray(v)) {
      out = `[${v.map((item) => walk(item) ?? "null").join(",")}]`
    } else {
      const record = v
      const parts: string[] = []
      for (const key of Object.keys(record).sort()) {
        const encoded = walk(record[key])
        if (encoded !== undefined) parts.push(`${JSON.stringify(key)}:${encoded}`)
      }
      out = `{${parts.join(",")}}`
    }
    seen.delete(v)
    return out
  }
  return walk(value) ?? "null"
}

function hex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, "0")).join("")
}

/** SHA-256 of raw bytes, as lowercase hex. */
export async function sha256Bytes(data: Uint8Array): Promise<string> {
  // Copy into a fresh ArrayBuffer-backed view so SharedArrayBuffer inputs are accepted.
  return hex(await crypto.subtle.digest("SHA-256", new Uint8Array(data)))
}

/** SHA-256 of a string's UTF-8 encoding, as lowercase hex. */
export async function sha256(text: string): Promise<string> {
  return sha256Bytes(new TextEncoder().encode(text))
}

/** SHA-256 of {@link stableStringify}(value): equal data ⇒ equal hash. */
export async function contentHash(value: StableValue): Promise<string> {
  return sha256(stableStringify(value))
}

/** True for a 64-char lowercase hex SHA-256 digest. */
export function isSha256Hex(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value)
}

/**
 * Compare two strings in time independent of where they first differ (only
 * length leaks). Use for comparing secrets such as webhook signatures.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
