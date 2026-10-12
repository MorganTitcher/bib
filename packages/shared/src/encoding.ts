/**
 * Byte ↔ text encodings: lowercase hex, standard padded base64 (RFC 4648 §4)
 * and unpadded base64url (RFC 4648 §5). Built on `btoa`/`atob`, so it runs in
 * Node, browsers and edge runtimes without `Buffer`.
 *
 * Decoders return `undefined` for malformed input instead of throwing, because
 * their inputs (cursors, tokens, payload fields) usually arrive from outside.
 *
 * @example
 * ```ts
 * import { base64UrlToBytes, bytesToBase64, bytesToBase64Url, bytesToHex } from "@bib/shared/encoding"
 *
 * const bytes = new TextEncoder().encode("hi?")
 * bytesToHex(bytes)          // "68693f"
 * bytesToBase64(bytes)       // "aGk/"
 * bytesToBase64Url(bytes)    // "aGk_"
 * base64UrlToBytes("aGk_")   // Uint8Array [104, 105, 63]
 * base64UrlToBytes("a")      // undefined
 * ```
 */

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"))

// Bounded so String.fromCharCode's argument list stays well under engine limits.
const CHUNK = 0x8000

function toBinaryString(bytes: Uint8Array): string {
  let binary = ""
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return binary
}

/** Lowercase hex, two characters per byte. */
export function bytesToHex(bytes: Uint8Array): string {
  let out = ""
  for (const b of bytes) out += HEX[b] ?? "00"
  return out
}

/** Standard padded base64. */
export function bytesToBase64(bytes: Uint8Array): string {
  return btoa(toBinaryString(bytes))
}

/** Decode canonical padded base64. Returns `undefined` for any other shape. */
export function base64ToBytes(text: string): Uint8Array | undefined {
  if (text.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) return undefined
  try {
    return Uint8Array.from(atob(text), (c) => c.charCodeAt(0))
  } catch {
    return undefined
  }
}

/** Unpadded base64url: `-` and `_` instead of `+` and `/`, no `=`. */
export function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")
}

/** Decode unpadded base64url. Returns `undefined` for any other shape. */
export function base64UrlToBytes(text: string): Uint8Array | undefined {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) return undefined
  const b64 = text.replaceAll("-", "+").replaceAll("_", "/")
  return base64ToBytes(b64 + "=".repeat((4 - (b64.length % 4)) % 4))
}
