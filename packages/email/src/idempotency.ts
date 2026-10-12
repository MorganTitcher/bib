/**
 * Application-level idempotency: send a message at most once per key, even
 * through providers that have no idempotency key of their own (Postmark,
 * SendGrid, SES).
 *
 * `withIdempotency(provider, { store })` claims the key in a pluggable
 * {@link IdempotencyStore} before sending:
 *
 * - key free → send, then record the result for `ttlMs` (default 24 h);
 * - key completed with the same payload → return the stored result with
 *   `deduplicated: true`, no send;
 * - key held by an in-flight send → `err(in_progress)` (retryable);
 * - key reused with a **different** payload → `err(idempotency_conflict)`.
 *
 * On a definite failure the claim is released so a later attempt can send. On
 * an ambiguous failure (`network`, `timeout`) it is released only when the
 * provider dedupes the key itself; otherwise the claim stays until
 * `pendingTtlMs` (default 15 min) expires, because the message may have been
 * sent.
 *
 * Keys come from `message.idempotencyKey` / `options.idempotencyKey`. With
 * `keyFrom: "content"`, a message without a key uses
 * {@link idempotencyKeyFor} (a hash of the content), which dedupes byte-for-byte
 * resends.
 *
 * A store failure fails closed (`unknown` error, no send) by default; set
 * `onStoreError: "send"` to prefer delivery over the guarantee.
 *
 * Shared stores (Redis, SQL) must make `begin` atomic, e.g. `SET key NX PX`
 * or an insert on a unique key; the bundled {@link createMemoryIdempotencyStore}
 * is single-process only.
 *
 * @example
 * ```ts
 * import { createMemoryIdempotencyStore, withIdempotency } from "@bib/email/idempotency"
 *
 * const provider = withIdempotency(withRetry(postmark), { store: createMemoryIdempotencyStore() })
 * await provider.send(message, { idempotencyKey: `receipt:${orderId}` })
 * ```
 */

import { errorMessage } from "@bib/shared/guards"
import { sha256, stableStringify } from "@bib/shared/hashing"
import { err, ok, type Result } from "@bib/shared/result"
import { EmailError } from "./errors.ts"
import type { EmailMessage } from "./message.ts"
import {
  type EmailProvider,
  effectiveIdempotencyKey,
  type SendOptions,
  type SendOutcome,
  type SendResult,
} from "./provider.ts"

/** What {@link IdempotencyStore.begin} found. */
export type BeginOutcome =
  | { readonly status: "started" }
  | { readonly status: "in_progress"; readonly fingerprint: string }
  | { readonly status: "completed"; readonly fingerprint: string; readonly result: SendResult }

/** Pluggable storage for idempotency claims. */
export interface IdempotencyStore {
  /** Atomically claim `key` for `ttlMs` unless a live claim or result exists. */
  begin(key: string, fingerprint: string, ttlMs: number): Promise<BeginOutcome>
  /** Record the result for `ttlMs`. */
  complete(key: string, fingerprint: string, result: SendResult, ttlMs: number): Promise<void>
  /** Drop a claim so the key can be used again. */
  release(key: string): Promise<void>
}

/** Options for {@link createMemoryIdempotencyStore}. */
export interface MemoryIdempotencyStoreOptions {
  /** Clock in ms. Default `Date.now`. */
  readonly now?: () => number
  /** Oldest entries are evicted beyond this. Default 10 000. */
  readonly maxEntries?: number
}

type Entry =
  | { state: "pending"; fingerprint: string; expiresAt: number }
  | { state: "done"; fingerprint: string; result: SendResult; expiresAt: number }

/** An in-process store with TTLs. Not shared across processes. */
export interface MemoryIdempotencyStore extends IdempotencyStore {
  readonly size: number
  clear(): void
}

/** Create an in-memory {@link IdempotencyStore}. */
export function createMemoryIdempotencyStore(
  options: MemoryIdempotencyStoreOptions = {},
): MemoryIdempotencyStore {
  const now = options.now ?? Date.now
  const maxEntries = options.maxEntries ?? 10_000
  const entries = new Map<string, Entry>()

  function live(key: string): Entry | undefined {
    const entry = entries.get(key)
    if (entry === undefined) return undefined
    if (entry.expiresAt <= now()) {
      entries.delete(key)
      return undefined
    }
    return entry
  }

  function set(key: string, entry: Entry): void {
    entries.delete(key)
    entries.set(key, entry)
    while (entries.size > maxEntries) {
      const oldest = entries.keys().next().value
      if (oldest === undefined) break
      entries.delete(oldest)
    }
  }

  return {
    async begin(key, fingerprint, ttlMs) {
      const entry = live(key)
      if (entry === undefined) {
        set(key, { state: "pending", fingerprint, expiresAt: now() + ttlMs })
        return { status: "started" }
      }
      if (entry.state === "pending")
        return { status: "in_progress", fingerprint: entry.fingerprint }
      return { status: "completed", fingerprint: entry.fingerprint, result: entry.result }
    },
    async complete(key, fingerprint, result, ttlMs) {
      set(key, { state: "done", fingerprint, result, expiresAt: now() + ttlMs })
    },
    async release(key) {
      entries.delete(key)
    },
    get size() {
      return entries.size
    },
    clear() {
      entries.clear()
    },
  }
}

/** A stable hash of a message's content, ignoring its idempotency key. */
export async function messageFingerprint(message: EmailMessage): Promise<string> {
  const addr = (a: EmailMessage["from"]) => ({ email: a.email, name: a.name })
  return sha256(
    stableStringify({
      from: addr(message.from),
      to: message.to.map(addr),
      cc: message.cc.map(addr),
      bcc: message.bcc.map(addr),
      replyTo: message.replyTo.map(addr),
      subject: message.subject,
      html: message.html,
      text: message.text,
      attachments: message.attachments.map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType,
        contentId: a.contentId,
        disposition: a.disposition,
      })),
      tags: message.tags.map((t) => ({ name: t.name, value: t.value })),
      headers: { ...message.headers },
      metadata: { ...message.metadata },
    }),
  )
}

/** A content-derived idempotency key: `content:<sha256>`. */
export async function idempotencyKeyFor(message: EmailMessage): Promise<string> {
  return `content:${await messageFingerprint(message)}`
}

/** Options for {@link withIdempotency}. */
export interface IdempotencyOptions {
  readonly store: IdempotencyStore
  /** How long a completed result is remembered. Default 24 h. */
  readonly ttlMs?: number
  /** How long an unfinished claim blocks the key. Default 15 min. */
  readonly pendingTtlMs?: number
  /** Default `"explicit"`: messages without a key pass straight through. */
  readonly keyFrom?: "explicit" | "content"
  /** Default `"fail"`. */
  readonly onStoreError?: "fail" | "send"
}

/** Default result TTL. */
export const DEFAULT_IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000
/** Default claim TTL. */
export const DEFAULT_PENDING_TTL_MS = 15 * 60 * 1000

/** Wrap a provider so each key is sent at most once. */
export function withIdempotency(
  provider: EmailProvider,
  options: IdempotencyOptions,
): EmailProvider {
  const { store } = options
  const ttlMs = options.ttlMs ?? DEFAULT_IDEMPOTENCY_TTL_MS
  const pendingTtlMs = options.pendingTtlMs ?? DEFAULT_PENDING_TTL_MS
  const keyFrom = options.keyFrom ?? "explicit"
  const onStoreError = options.onStoreError ?? "fail"

  const storeError = (step: string, thrown: unknown): EmailError =>
    new EmailError("unknown", `idempotency store ${step} failed: ${errorMessage(thrown)}`, {
      provider: provider.name,
      cause: thrown,
    })

  async function send(message: EmailMessage, sendOptions?: SendOptions): Promise<SendOutcome> {
    let key = effectiveIdempotencyKey(message, sendOptions)
    if (key === undefined && keyFrom === "content") key = await idempotencyKeyFor(message)
    if (key === undefined) return provider.send(message, sendOptions)
    const fingerprint = await messageFingerprint(message)
    const callOptions: SendOptions = { signal: sendOptions?.signal, idempotencyKey: key }

    let begun: BeginOutcome
    try {
      begun = await store.begin(key, fingerprint, pendingTtlMs)
    } catch (thrown) {
      if (onStoreError === "send") return provider.send(message, callOptions)
      return err(storeError("begin", thrown))
    }
    if (begun.status !== "started") {
      if (begun.fingerprint !== fingerprint) {
        return err(
          new EmailError(
            "idempotency_conflict",
            "idempotency key was reused with a different message",
            {
              provider: provider.name,
            },
          ),
        )
      }
      if (begun.status === "in_progress") {
        return err(
          new EmailError("in_progress", "a send with this idempotency key is already in progress", {
            provider: provider.name,
          }),
        )
      }
      return ok({ ...begun.result, deduplicated: true })
    }

    const outcome = await provider.send(message, callOptions)
    try {
      if (outcome.ok) {
        await store.complete(key, fingerprint, outcome.value, ttlMs)
      } else if (!outcome.error.ambiguous || provider.capabilities.idempotency) {
        await store.release(key)
      }
    } catch {
      // The send outcome is what matters to the caller; a failed bookkeeping
      // write only means a later duplicate check may miss or wait for expiry.
    }
    return outcome
  }

  const wrapped: EmailProvider = { name: provider.name, capabilities: provider.capabilities, send }
  const health = provider.healthCheck
  if (health === undefined) return wrapped
  return {
    ...wrapped,
    healthCheck: (opts?: { readonly signal?: AbortSignal }): Promise<Result<void, EmailError>> =>
      health.call(provider, opts),
  }
}
