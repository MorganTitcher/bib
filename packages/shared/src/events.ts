/**
 * A tiny, type-safe event emitter. The event map type fixes which events exist
 * and the payload each carries, so `emit("paid", wrongPayload)` and listening to
 * a misspelled event are compile errors.
 *
 * Semantics:
 * - Listeners run synchronously, in registration order.
 * - Adding or removing listeners during an `emit` does not affect that emit
 *   (a snapshot is taken).
 * - A throwing listener does not stop the others; errors are collected and
 *   rethrown afterwards (a single error as-is, several as an `AggregateError`).
 *
 * @example
 * ```ts
 * import { TypedEventEmitter } from "@bib/shared/events"
 *
 * type InvoiceEvents = {
 *   paid: { invoiceId: string; amountMinor: bigint }
 *   voided: { invoiceId: string }
 * }
 *
 * const bus = new TypedEventEmitter<InvoiceEvents>()
 * const off = bus.on("paid", ({ invoiceId }) => console.log("paid", invoiceId))
 * bus.once("voided", (e) => console.log("voided", e.invoiceId))
 * bus.emit("paid", { invoiceId: "inv_1", amountMinor: 1999n })
 * off() // unsubscribe
 * ```
 */

/** Listener for payload `P`. */
export type Listener<P> = (payload: P) => void

type ListenerTable<Events> = { [K in keyof Events]?: Set<Listener<Events[K]>> }

/**
 * Synchronous typed pub/sub. `Events` maps each event name to its payload type;
 * both `type` aliases and `interface`s work.
 *
 * Note: a listener registered with {@link TypedEventEmitter.once} is wrapped, so
 * remove it with the function `once` returns, not with `off(event, listener)`.
 */
export class TypedEventEmitter<Events extends object> {
  // Prototype-less so an event named e.g. "toString" never hits Object.prototype.
  readonly #listeners: ListenerTable<Events> = Object.create(null)

  /** Subscribe; returns an unsubscribe function. */
  on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): () => void {
    let set = this.#listeners[event]
    if (!set) {
      set = new Set()
      this.#listeners[event] = set
    }
    set.add(listener)
    return () => this.off(event, listener)
  }

  /** Subscribe for the next emit only. Returns an unsubscribe function. */
  once<K extends keyof Events>(event: K, listener: Listener<Events[K]>): () => void {
    const off = this.on(event, (payload) => {
      off()
      listener(payload)
    })
    return off
  }

  /** Remove a listener. Removing one that is not registered is a no-op. */
  off<K extends keyof Events>(event: K, listener: Listener<Events[K]>): void {
    const set = this.#listeners[event]
    if (!set) return
    set.delete(listener)
    if (set.size === 0) delete this.#listeners[event]
  }

  /** Deliver `payload` to every listener of `event`. Returns whether any listener ran. */
  emit<K extends keyof Events>(event: K, payload: Events[K]): boolean {
    const set = this.#listeners[event]
    if (!set || set.size === 0) return false
    const errors: unknown[] = []
    for (const listener of [...set]) {
      try {
        listener(payload)
      } catch (error) {
        errors.push(error)
      }
    }
    if (errors.length === 1) throw errors[0]
    if (errors.length > 1) throw new AggregateError(errors, `${errors.length} listeners threw`)
    return true
  }

  /** Number of listeners for one event. */
  listenerCount<K extends keyof Events>(event: K): number {
    return this.#listeners[event]?.size ?? 0
  }

  /** Remove all listeners for `event`, or for every event when omitted. */
  removeAll(event?: keyof Events): void {
    if (event !== undefined) {
      delete this.#listeners[event]
      return
    }
    for (const key of Reflect.ownKeys(this.#listeners)) Reflect.deleteProperty(this.#listeners, key)
  }
}
