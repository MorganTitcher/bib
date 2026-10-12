import { describe, expect, it, vi } from "vitest"
import { TypedEventEmitter } from "../src/events.ts"

type Events = {
  paid: { id: string }
  voided: { id: string }
  toString: number
}

describe("TypedEventEmitter", () => {
  it("delivers payloads in registration order", () => {
    const bus = new TypedEventEmitter<Events>()
    const order: string[] = []
    bus.on("paid", (e) => order.push(`a:${e.id}`))
    bus.on("paid", (e) => order.push(`b:${e.id}`))
    expect(bus.emit("paid", { id: "1" })).toBe(true)
    expect(order).toEqual(["a:1", "b:1"])
  })

  it("returns false when nobody listens", () => {
    const bus = new TypedEventEmitter<Events>()
    expect(bus.emit("voided", { id: "1" })).toBe(false)
  })

  it("unsubscribes via the returned function and off", () => {
    const bus = new TypedEventEmitter<Events>()
    const fn = vi.fn()
    const off = bus.on("paid", fn)
    off()
    off()
    bus.emit("paid", { id: "1" })
    expect(fn).not.toHaveBeenCalled()
    bus.on("paid", fn)
    bus.off("paid", fn)
    bus.off("voided", fn)
    expect(bus.listenerCount("paid")).toBe(0)
  })

  it("once fires a single time", () => {
    const bus = new TypedEventEmitter<Events>()
    const fn = vi.fn()
    bus.once("paid", fn)
    bus.emit("paid", { id: "1" })
    bus.emit("paid", { id: "2" })
    expect(fn).toHaveBeenCalledTimes(1)
    const off = bus.once("paid", fn)
    off()
    bus.emit("paid", { id: "3" })
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it("snapshots listeners during emit", () => {
    const bus = new TypedEventEmitter<Events>()
    const late = vi.fn()
    bus.on("paid", () => {
      bus.on("paid", late)
    })
    bus.emit("paid", { id: "1" })
    expect(late).not.toHaveBeenCalled()
    expect(bus.listenerCount("paid")).toBe(2)
  })

  it("isolates throwing listeners", () => {
    const bus = new TypedEventEmitter<Events>()
    const after = vi.fn()
    bus.on("paid", () => {
      throw new Error("one")
    })
    bus.on("paid", after)
    expect(() => bus.emit("paid", { id: "1" })).toThrow("one")
    expect(after).toHaveBeenCalled()

    bus.on("paid", () => {
      throw new Error("two")
    })
    expect(() => bus.emit("paid", { id: "1" })).toThrow(AggregateError)
  })

  it("handles event names that shadow Object.prototype", () => {
    const bus = new TypedEventEmitter<Events>()
    expect(bus.listenerCount("toString")).toBe(0)
    expect(bus.emit("toString", 1)).toBe(false)
    const fn = vi.fn()
    bus.on("toString", fn)
    bus.emit("toString", 2)
    expect(fn).toHaveBeenCalledWith(2)
  })

  it("removeAll clears one or every event", () => {
    const bus = new TypedEventEmitter<Events>()
    bus.on("paid", () => {})
    bus.on("voided", () => {})
    bus.removeAll("paid")
    expect(bus.listenerCount("paid")).toBe(0)
    expect(bus.listenerCount("voided")).toBe(1)
    bus.removeAll()
    expect(bus.listenerCount("voided")).toBe(0)
  })
})
