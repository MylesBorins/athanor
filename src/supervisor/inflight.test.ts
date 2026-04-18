import { describe, it, expect, beforeEach } from "vitest"
import { begin, end, inflight, awaitIdle, _reset } from "./inflight.js"

describe("inflight ref-count", () => {
  beforeEach(() => { _reset() })

  it("awaitIdle resolves immediately when the slot is empty", async () => {
    const ok = await awaitIdle("unknown/id", 1000)
    expect(ok).toBe(true)
  })

  it("tracks begin/end per id and reports the count", () => {
    begin("a"); begin("a"); begin("b")
    expect(inflight("a")).toBe(2)
    expect(inflight("b")).toBe(1)
    end("a")
    expect(inflight("a")).toBe(1)
    expect(inflight("b")).toBe(1)
  })

  it("awaitIdle resolves when count reaches zero", async () => {
    begin("x")
    let drained = false
    const p = awaitIdle("x", 5000).then(ok => { drained = ok })
    expect(drained).toBe(false)
    end("x")
    await p
    expect(drained).toBe(true)
  })

  it("awaitIdle resolves false on timeout", async () => {
    begin("slow")
    const ok = await awaitIdle("slow", 20)
    expect(ok).toBe(false)
    // The slot should still have its count; end() must clean it up.
    expect(inflight("slow")).toBe(1)
    end("slow")
    expect(inflight("slow")).toBe(0)
  })

  it("isolates ids: begin on one does not block awaitIdle on another", async () => {
    begin("busy")
    const ok = await awaitIdle("idle", 1000)
    expect(ok).toBe(true)
    end("busy")
  })

  it("end on a missing id is a no-op", () => {
    expect(() => end("never-began")).not.toThrow()
    expect(inflight("never-began")).toBe(0)
  })

  it("awaitIdle with timeoutMs=0 resolves false when busy, true when idle", async () => {
    begin("z")
    expect(await awaitIdle("z", 0)).toBe(false)
    end("z")
    expect(await awaitIdle("z", 0)).toBe(true)
  })

  it("multiple concurrent waiters on the same id all resolve", async () => {
    begin("multi")
    const w1 = awaitIdle("multi", 5000)
    const w2 = awaitIdle("multi", 5000)
    end("multi")
    expect(await w1).toBe(true)
    expect(await w2).toBe(true)
  })
})
