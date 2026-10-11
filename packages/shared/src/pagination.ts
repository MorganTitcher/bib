/**
 * Pagination helpers: opaque cursors and offset math.
 *
 * Cursors are base64url-encoded JSON. They are OPAQUE, not secret or tamper-proof:
 * a client can decode and edit one, so always re-validate the decoded value
 * (that is what the `validate` argument of {@link decodeCursor} is for) and
 * never put authorization data in a cursor.
 *
 * @example
 * ```ts
 * import { encodeCursor, decodeCursor, paginateArray } from "@bib/shared/pagination"
 *
 * const cursor = encodeCursor({ id: "inv_42", createdAt: "2026-01-01" })
 * decodeCursor(cursor) // { id: "inv_42", createdAt: "2026-01-01" }
 *
 * const page = paginateArray(["a", "b", "c", "d", "e"], { limit: 2 })
 * // { items: ["a","b"], nextCursor: "...", hasMore: true }
 * paginateArray(["a", "b", "c", "d", "e"], { limit: 2, cursor: page.nextCursor })
 * // { items: ["c","d"], ... }
 * ```
 */

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ""
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")
}

function base64UrlToBytes(text: string): Uint8Array | undefined {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) return undefined
  const b64 = text.replaceAll("-", "+").replaceAll("_", "/")
  try {
    const binary = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4))
    return Uint8Array.from(binary, (c) => c.charCodeAt(0))
  } catch {
    return undefined
  }
}

/** Encode any JSON-serializable value as an opaque URL-safe cursor. */
export function encodeCursor(value: unknown): string {
  const json = JSON.stringify(value)
  if (json === undefined) throw new TypeError("Cursor value is not JSON-serializable")
  return bytesToBase64Url(new TextEncoder().encode(json))
}

/**
 * Decode a cursor. Returns `undefined` for anything malformed — never throws —
 * so an invalid client cursor can be turned into a 400 response by the caller.
 * Pass `validate` (a type guard) to narrow the result.
 */
export function decodeCursor(cursor: string): unknown
export function decodeCursor<T>(
  cursor: string,
  validate: (value: unknown) => value is T,
): T | undefined
export function decodeCursor<T>(
  cursor: string,
  validate?: (value: unknown) => value is T,
): unknown {
  const bytes = base64UrlToBytes(cursor)
  if (!bytes) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
  } catch {
    return undefined
  }
  if (validate && !validate(parsed)) return undefined
  return parsed
}

/** One page of results. */
export interface Page<T> {
  readonly items: T[]
  /** Pass back to fetch the next page; `undefined` on the last page. */
  readonly nextCursor: string | undefined
  readonly hasMore: boolean
}

/** Default and maximum page sizes. */
export const DEFAULT_PAGE_SIZE = 20
export const MAX_PAGE_SIZE = 100

/** Clamp a requested page size into `[1, max]`; non-integers fall back to the default. */
export function clampLimit(
  limit: number | undefined,
  max: number = MAX_PAGE_SIZE,
  fallback: number = DEFAULT_PAGE_SIZE,
): number {
  if (limit === undefined || !Number.isFinite(limit)) return Math.min(fallback, max)
  return Math.min(Math.max(1, Math.trunc(limit)), max)
}

const isOffsetCursor = (v: unknown): v is { o: number } =>
  typeof v === "object" &&
  v !== null &&
  "o" in v &&
  typeof v.o === "number" &&
  Number.isInteger(v.o) &&
  v.o >= 0

/**
 * Cursor-paginate an in-memory array (the cursor encodes an offset). A
 * malformed cursor throws a RangeError so it is not silently treated as page 1.
 */
export function paginateArray<T>(
  items: readonly T[],
  options: { readonly limit?: number; readonly cursor?: string | undefined } = {},
): Page<T> {
  const limit = clampLimit(options.limit)
  let start = 0
  if (options.cursor !== undefined) {
    const decoded = decodeCursor(options.cursor, isOffsetCursor)
    if (!decoded) throw new RangeError("Invalid pagination cursor")
    start = decoded.o
  }
  const end = start + limit
  const hasMore = end < items.length
  return {
    items: items.slice(start, end),
    nextCursor: hasMore ? encodeCursor({ o: end }) : undefined,
    hasMore,
  }
}

/** Offset/page metadata for numbered pagination UIs. */
export interface OffsetPageInfo {
  readonly page: number
  readonly pageSize: number
  readonly offset: number
  readonly totalItems: number
  readonly totalPages: number
  readonly hasPrevious: boolean
  readonly hasNext: boolean
}

/**
 * Compute offset metadata for 1-based `page`. Pages below 1 clamp to 1; pages
 * beyond the end are reported as-is (offset past the end, `hasNext` false) so the
 * caller can decide between an empty page and a redirect.
 *
 * @example
 * ```ts
 * offsetPageInfo({ page: 3, pageSize: 10, totalItems: 45 })
 * // { page: 3, pageSize: 10, offset: 20, totalItems: 45, totalPages: 5, hasPrevious: true, hasNext: true }
 * ```
 */
export function offsetPageInfo(input: {
  readonly page: number
  readonly pageSize: number
  readonly totalItems: number
}): OffsetPageInfo {
  const pageSize = clampLimit(input.pageSize)
  const page = Number.isFinite(input.page) ? Math.max(1, Math.trunc(input.page)) : 1
  const totalItems = Math.max(0, Math.trunc(input.totalItems))
  const totalPages = Math.ceil(totalItems / pageSize)
  return {
    page,
    pageSize,
    offset: (page - 1) * pageSize,
    totalItems,
    totalPages,
    hasPrevious: page > 1,
    hasNext: page < totalPages,
  }
}
