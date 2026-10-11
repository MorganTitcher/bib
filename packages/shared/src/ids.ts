/**
 * Identifier generation backed by the Web Crypto CSPRNG (`crypto.getRandomValues`),
 * available in Node 20+, browsers, and edge runtimes. Never uses `Math.random`.
 *
 * - {@link uuidv7}: RFC 9562 version 7 — time-ordered, so it sorts by creation
 *   time and indexes well as a database primary key.
 * - {@link generateToken}: opaque secret token (hex or base64url).
 * - {@link prefixedId}: Stripe-style typed ids (`cus_...`) whose prefix makes
 *   a mixed-up id obvious in logs.
 * - {@link shortId}: short human-shareable id from an unambiguous alphabet.
 *
 * @example
 * ```ts
 * import { uuidv7, generateToken, prefixedId, shortId } from "@bib/shared/ids"
 *
 * uuidv7()             // "01929d3e-5c4b-7a2f-9e1d-3b8c4f6a2d10"
 * generateToken(32)    // 64 hex chars
 * prefixedId("cus")    // "cus_01J9QX3V7Z8K2M4N6P8R0T2V4W" (26-char ULID-like body)
 * shortId()            // "k7m2q9xd"
 * ```
 */

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"))

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return bytes
}

function toHex(bytes: Uint8Array): string {
  let out = ""
  for (const b of bytes) out += HEX[b] ?? "00"
  return out
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ""
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** True for a canonical RFC 9562 UUID (versions 1–8, RFC variant). */
export function isUuid(value: string): boolean {
  return UUID_RE.test(value)
}

/**
 * A UUID version 7: 48-bit Unix-millisecond timestamp, then 74 random bits.
 * Ids generated in later milliseconds sort after earlier ones (lexicographic
 * string order equals time order). Within one millisecond order is random.
 *
 * @param now - Clock in ms; injectable for tests. Must be 0 ≤ now < 2^48.
 */
export function uuidv7(now: number = Date.now()): string {
  if (!Number.isInteger(now) || now < 0 || now >= 2 ** 48) {
    throw new RangeError(`uuidv7 timestamp out of range: ${now}`)
  }
  const bytes = randomBytes(16)
  let ts = now
  for (let i = 5; i >= 0; i--) {
    bytes[i] = ts % 256
    ts = Math.floor(ts / 256)
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
  const h = toHex(bytes)
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

/** Extract the creation time (ms) from a UUID v7, or `undefined` for other versions. */
export function uuidv7Timestamp(id: string): number | undefined {
  if (!isUuid(id) || id[14] !== "7") return undefined
  return Number.parseInt(id.slice(0, 8) + id.slice(9, 13), 16)
}

/**
 * Opaque random token with `byteLength` bytes of entropy (default 32 = 256 bits).
 * Hex doubles the byte length in characters; base64url is ~4/3.
 */
export function generateToken(byteLength = 32, encoding: "hex" | "base64url" = "hex"): string {
  if (!Number.isInteger(byteLength) || byteLength < 1 || byteLength > 65_536) {
    throw new RangeError(`byteLength must be an integer in 1..65536, got ${byteLength}`)
  }
  const bytes = randomBytes(byteLength)
  return encoding === "hex" ? toHex(bytes) : toBase64Url(bytes)
}

/** Crockford base32: no I, L, O, U — unambiguous when read aloud or typed. */
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

/**
 * Typed, time-sortable id: `<prefix>_<26 Crockford base32 chars>` — a 48-bit ms
 * timestamp followed by 80 random bits (ULID layout). The prefix must be
 * lowercase letters/digits, starting with a letter, at most 16 chars.
 */
export function prefixedId(prefix: string, now: number = Date.now()): string {
  if (!/^[a-z][a-z0-9]{0,15}$/.test(prefix)) {
    throw new RangeError(`Invalid id prefix: ${JSON.stringify(prefix)}`)
  }
  if (!Number.isInteger(now) || now < 0 || now >= 2 ** 48) {
    throw new RangeError(`timestamp out of range: ${now}`)
  }
  let time = ""
  let ts = now
  for (let i = 0; i < 10; i++) {
    time = (CROCKFORD[ts % 32] ?? "0") + time
    ts = Math.floor(ts / 32)
  }
  const rand = randomBytes(16)
  let random = ""
  for (let i = 0; i < 16; i++) random += CROCKFORD[(rand[i] ?? 0) % 32] ?? "0"
  return `${prefix}_${time}${random}`
}

/** Split a prefixed id into `[prefix, body]`, or `undefined` if it has no `_`. */
export function parsePrefixedId(id: string): readonly [prefix: string, body: string] | undefined {
  const idx = id.indexOf("_")
  if (idx <= 0 || idx === id.length - 1) return undefined
  return [id.slice(0, idx), id.slice(idx + 1)]
}

const SHORT_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz"

/**
 * Short random id (default 8 chars) from a 31-letter alphabet without
 * look-alikes (0/o, 1/l/i). Uses rejection sampling so every character is
 * uniformly likely. 8 chars ≈ 39.6 bits — fine for share codes, NOT for secrets.
 */
export function shortId(length = 8, alphabet: string = SHORT_ALPHABET): string {
  if (!Number.isInteger(length) || length < 1) {
    throw new RangeError(`length must be a positive integer, got ${length}`)
  }
  if (alphabet.length < 2 || alphabet.length > 256) {
    throw new RangeError("alphabet must have 2..256 characters")
  }
  const limit = 256 - (256 % alphabet.length)
  let out = ""
  while (out.length < length) {
    for (const b of randomBytes(length * 2)) {
      if (b < limit) out += alphabet[b % alphabet.length] ?? ""
      if (out.length === length) break
    }
  }
  return out
}
