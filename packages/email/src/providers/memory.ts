/**
 * An in-memory provider for tests: records every accepted message and can be
 * scripted to fail.
 *
 * - `sent` holds `{ message, options, result }` for every accepted send.
 * - `failNext(error, times?)` makes the next `times` sends (default 1) return
 *   `err(error)` without recording. Queued failures are consumed in order.
 * - `failWith(fn)` installs a predicate-based failure for every send until
 *   `reset()`.
 * - `calls` counts every `send` call, accepted or not.
 *
 * @example
 * ```ts
 * import { createMemoryProvider } from "@bib/email/providers/memory"
 * import { EmailError } from "@bib/email/errors"
 *
 * const memory = createMemoryProvider()
 * memory.failNext(new EmailError("unavailable", "down"))
 * await client.send(input) // first attempt fails, a retry succeeds
 * expect(memory.sent).toHaveLength(1)
 * ```
 */

import { err, ok, type Result } from "@bib/shared/result"
import { EmailError } from "../errors.ts"
import type { EmailMessage } from "../message.ts"
import {
  checkCapabilities,
  type EmailProvider,
  type ProviderCapabilities,
  type SendOptions,
  type SendOutcome,
  type SendResult,
  sendResult,
} from "../provider.ts"

/** One accepted send. */
export interface SentEmail {
  readonly message: EmailMessage
  readonly options: SendOptions | undefined
  readonly result: SendResult
}

/** The memory provider, with inspection and scripting helpers. */
export interface MemoryProvider extends EmailProvider {
  readonly sent: readonly SentEmail[]
  /** Number of `send` calls, accepted or failed. */
  readonly calls: number
  /** The last accepted message, if any. */
  last(): SentEmail | undefined
  /** Fail the next `times` sends with `error`. */
  failNext(error: EmailError, times?: number): void
  /** Fail any send for which `fn` returns an error. */
  failWith(fn: (message: EmailMessage, call: number) => EmailError | undefined): void
  /** Drop recorded sends, queued failures and the call count. */
  reset(): void
}

/** Options for {@link createMemoryProvider}. */
export interface MemoryProviderOptions {
  /** Default `"memory"`. */
  readonly name?: string
  /** Override the capabilities (e.g. to exercise capability checks). */
  readonly capabilities?: Partial<ProviderCapabilities>
  readonly now?: () => Date
}

/** Create an in-memory provider. Message ids are `<name>-1`, `<name>-2`, ... */
export function createMemoryProvider(options: MemoryProviderOptions = {}): MemoryProvider {
  const name = options.name ?? "memory"
  const capabilities: ProviderCapabilities = {
    maxRecipients: 1000,
    attachments: true,
    idempotency: true,
    tags: true,
    metadata: true,
    customHeaders: true,
    ...options.capabilities,
  }
  const sent: SentEmail[] = []
  let queued: EmailError[] = []
  let predicate: ((message: EmailMessage, call: number) => EmailError | undefined) | undefined
  let calls = 0
  let ids = 0

  async function send(message: EmailMessage, sendOptions?: SendOptions): Promise<SendOutcome> {
    calls += 1
    if (sendOptions?.signal?.aborted) {
      return err(new EmailError("aborted", "send aborted", { provider: name }))
    }
    const fits = checkCapabilities(name, capabilities, message)
    if (!fits.ok) return fits
    const next = queued.shift()
    if (next !== undefined) return err(next)
    const scripted = predicate?.(message, calls)
    if (scripted !== undefined) return err(scripted)
    ids += 1
    const result = sendResult(name, `${name}-${ids}`, options.now?.() ?? new Date())
    sent.push({ message, options: sendOptions, result })
    return ok(result)
  }

  async function healthCheck(): Promise<Result<void, EmailError>> {
    return ok(undefined)
  }

  return {
    name,
    capabilities,
    send,
    healthCheck,
    get sent() {
      return sent
    },
    get calls() {
      return calls
    },
    last: () => sent[sent.length - 1],
    failNext(error, times = 1) {
      for (let i = 0; i < times; i++) queued.push(error)
    },
    failWith(fn) {
      predicate = fn
    },
    reset() {
      sent.length = 0
      queued = []
      predicate = undefined
      calls = 0
      ids = 0
    },
  }
}
