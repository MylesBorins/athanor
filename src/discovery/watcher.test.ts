import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import type { ModelEntry } from "../types/index.js"
import type { WatchFactory } from "./watcher.js"

// Captures the listeners passed to fs.watch by the watcher so tests
// can fire synthetic events deterministically. Real fsevents delivery
// on macOS is asynchronous and hard to time in unit tests; this
// bypasses the kernel entirely.
function makeFakeWatch(): {
  factory: WatchFactory
  fireOn(dir: string): void
  fireError(dir: string, err: Error): void
  watched(): string[]
  closed(): string[]
} {
  const listeners = new Map<string, () => void>()
  const errorListeners = new Map<string, (err: Error) => void>()
  const closed: string[] = []
  const factory: WatchFactory = (dir, listener) => {
    listeners.set(dir, listener)
    return {
      close: () => { closed.push(dir); listeners.delete(dir) },
      on: (event: string, cb: any) => {
        if (event === "error") errorListeners.set(dir, cb)
      },
      off: () => {}, unref: () => {}, ref: () => {}
    } as unknown as fs.FSWatcher
  }
  return {
    factory,
    fireOn: dir => listeners.get(dir)?.(),
    fireError: (dir, err) => errorListeners.get(dir)?.(err),
    watched: () => [...listeners.keys()],
    closed: () => closed
  }
}

describe("startCacheWatcher", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "athanor-watcher-"))
  const hub = path.join(tmp, "hub")
  fs.mkdirSync(hub, { recursive: true })

  beforeEach(() => {
    vi.useFakeTimers()
    vi.resetModules()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.doUnmock("../config/index.js")
  })

  async function loadWatcher(modelDirs: { mlx: string; llama: string }) {
    vi.doMock("../config/index.js", async () => {
      const real: any = await vi.importActual("../config/index.js")
      return { ...real, getModelDirs: () => modelDirs }
    })
    return (await import("./watcher.js")).startCacheWatcher
  }

  function entry(slug: string): ModelEntry {
    return {
      id: `mlx-community/${slug}`, slug, path: "/cache/" + slug,
      runtime: "mlx", source: { type: "hf", repo: "mlx-community/" + slug },
      port: 8081, publish: true, addedAt: 0
    }
  }

  it("debounces burst events into a single scan", async () => {
    const start = await loadWatcher({ mlx: hub, llama: hub })
    const fake = makeFakeWatch()
    const ingest = vi.fn(() => ({ added: [], updatedPath: [], unchanged: 0 }))
    const onAdded = vi.fn()
    const w = start(onAdded, { ingest, watchFactory: fake.factory, debounceMs: 200 })
    fake.fireOn(hub); fake.fireOn(hub); fake.fireOn(hub)
    expect(ingest).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(200)
    expect(ingest).toHaveBeenCalledTimes(1)
    expect(onAdded).not.toHaveBeenCalled()
    w.stop()
  })

  it("emits onAdded only when the ingest report has added entries", async () => {
    const start = await loadWatcher({ mlx: hub, llama: hub })
    const fake = makeFakeWatch()
    const ingest = vi.fn()
      .mockReturnValueOnce({ added: [], updatedPath: [entry("a")], unchanged: 0 })
      .mockReturnValueOnce({ added: [entry("b")], updatedPath: [], unchanged: 1 })
    const onAdded = vi.fn()
    const w = start(onAdded, { ingest, watchFactory: fake.factory, debounceMs: 100 })
    fake.fireOn(hub); await vi.advanceTimersByTimeAsync(100)
    expect(onAdded).not.toHaveBeenCalled()
    fake.fireOn(hub); await vi.advanceTimersByTimeAsync(100)
    expect(onAdded).toHaveBeenCalledTimes(1)
    expect(onAdded.mock.calls[0]![0]).toHaveLength(1)
    expect(onAdded.mock.calls[0]![0][0].slug).toBe("b")
    w.stop()
  })

  it("stop() clears pending scans, closes watchers, blocks late firings", async () => {
    const start = await loadWatcher({ mlx: hub, llama: hub })
    const fake = makeFakeWatch()
    const ingest = vi.fn(() => ({ added: [entry("x")], updatedPath: [], unchanged: 0 }))
    const onAdded = vi.fn()
    const w = start(onAdded, { ingest, watchFactory: fake.factory, debounceMs: 500 })
    fake.fireOn(hub)
    w.stop()
    expect(fake.closed()).toEqual([hub])
    // Fire after stop to exercise if (stopped) return in schedule
    fake.fireOn(hub)
    await vi.advanceTimersByTimeAsync(1000)
    expect(ingest).not.toHaveBeenCalled()
    expect(onAdded).not.toHaveBeenCalled()
  })

  it("skips missing directories without calling onError", async () => {
    const start = await loadWatcher({
      mlx: path.join(tmp, "nope"),
      llama: path.join(tmp, "also-nope")
    })
    const fake = makeFakeWatch()
    const onError = vi.fn()
    const w = start(() => { /* noop */ }, {
      ingest: () => ({ added: [], updatedPath: [], unchanged: 0 }),
      watchFactory: fake.factory,
      onError
    })
    expect(fake.watched()).toEqual([])
    expect(onError).not.toHaveBeenCalled()
    w.stop()
  })

  it("dedupes watch targets when mlx and llama point at the same path", async () => {
    const start = await loadWatcher({ mlx: hub, llama: hub })
    const fake = makeFakeWatch()
    const w = start(() => { /* noop */ }, {
      ingest: () => ({ added: [], updatedPath: [], unchanged: 0 }),
      watchFactory: fake.factory
    })
    expect(fake.watched()).toEqual([hub])
    w.stop()
  })

  it("does not throw when ingest fails; keeps watching", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => { /* silence */ })
    const start = await loadWatcher({ mlx: hub, llama: hub })
    const fake = makeFakeWatch()
    const ingest = vi.fn()
      .mockImplementationOnce(() => { throw new Error("boom") })
      .mockImplementationOnce(() => ({ added: [entry("ok")], updatedPath: [], unchanged: 0 }))
    const onAdded = vi.fn()
    const w = start(onAdded, { ingest, watchFactory: fake.factory, debounceMs: 50 })
    fake.fireOn(hub); await vi.advanceTimersByTimeAsync(50)
    expect(onAdded).not.toHaveBeenCalled()
    fake.fireOn(hub); await vi.advanceTimersByTimeAsync(50)
    expect(onAdded).toHaveBeenCalledTimes(1)
    err.mockRestore()
    w.stop()
  })

  it("handles watcher error events and invokes default and custom onError", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const start = await loadWatcher({ mlx: hub, llama: hub })
    const fake = makeFakeWatch()
    const w = start(() => {}, {
      watchFactory: fake.factory
    })
    fake.fireError(hub, new Error("EACCES permission denied"))
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("cache watcher could not attach to")
    )
    errorSpy.mockRestore()
    w.stop()

    // With custom onError
    const customOnError = vi.fn()
    const fake2 = makeFakeWatch()
    const w2 = start(() => {}, {
      watchFactory: fake2.factory,
      onError: customOnError
    })
    fake2.fireError(hub, new Error("custom error"))
    expect(customOnError).toHaveBeenCalledWith(hub, expect.objectContaining({ message: "custom error" }))
    w2.stop()
  })

  it("handles synchronous throws from watchFactory", async () => {
    const start = await loadWatcher({ mlx: hub, llama: hub })
    const onError = vi.fn()
    const failingFactory: WatchFactory = () => {
      throw new Error("sync watch failure")
    }
    const w = start(() => {}, {
      watchFactory: failingFactory,
      onError
    })
    expect(onError).toHaveBeenCalledWith(hub, expect.objectContaining({ message: "sync watch failure" }))
    w.stop()
  })

  it("logs non-Error exceptions in ingest scanner gracefully", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const start = await loadWatcher({ mlx: hub, llama: hub })
    const fake = makeFakeWatch()
    const ingest = vi.fn(() => {
      throw "string-error-message"
    })
    const w = start(() => {}, {
      ingest: ingest as any,
      watchFactory: fake.factory,
      debounceMs: 50
    })
    fake.fireOn(hub)
    await vi.advanceTimersByTimeAsync(50)
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("athanor: watcher scan failed: string-error-message")
    )
    errorSpy.mockRestore()
    w.stop()
  })

  it("uses real fs.watch by default when watchFactory is omitted", async () => {
    const start = await loadWatcher({ mlx: hub, llama: hub })
    const ingest = vi.fn(() => ({ added: [], updatedPath: [], unchanged: 0 }))
    const w = start(() => {}, {
      ingest,
      debounceMs: 100
    })
    // Ensure stop works cleanly on real fs.watch instances
    expect(() => w.stop()).not.toThrow()
  })
})
