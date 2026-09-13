import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { makeCliPullRenderer } from "./pull-renderer.js"

describe("makeCliPullRenderer", () => {
  let writeCalls: string[] = []
  let originalIsTTY: boolean | undefined
  let originalColumns: number | undefined

  beforeEach(() => {
    writeCalls = []
    originalIsTTY = process.stdout.isTTY
    originalColumns = process.stdout.columns
    vi.spyOn(process.stdout, "write").mockImplementation((str: any) => {
      writeCalls.push(String(str))
      return true
    })
  })

  afterEach(() => {
    Object.defineProperty(process.stdout, "isTTY", { value: originalIsTTY, configurable: true })
    Object.defineProperty(process.stdout, "columns", { value: originalColumns, configurable: true })
    vi.restoreAllMocks()
  })

  describe("non-TTY mode", () => {
    beforeEach(() => {
      Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true })
    })

    it("logs milestone when resolving repo with revision", () => {
      const renderer = makeCliPullRenderer()
      renderer.onEvent({ type: "resolving", repo: "mlx-community/Qwen2.5-7B", revision: "v1.0" })

      expect(writeCalls.join("")).toContain("resolving mlx-community/Qwen2.5-7B@v1.0…\n")
    })

    it("logs milestone when resolving repo without revision", () => {
      const renderer = makeCliPullRenderer()
      renderer.onEvent({ type: "resolving", repo: "mlx-community/Qwen2.5-7B" })

      expect(writeCalls.join("")).toContain("resolving mlx-community/Qwen2.5-7B…\n")
    })

    it("tracks file completion and emits end milestone and finish summary", () => {
      const renderer = makeCliPullRenderer()
      renderer.onEvent({
        type: "progress",
        file: "model-00001.safetensors",
        done: 512,
        total: 1024,
        unit: "B",
        rate: 256,
        elapsed: 1
      })
      renderer.onEvent({
        type: "end",
        file: "model-00001.safetensors",
        done: 1024,
        total: 1024,
        unit: "B"
      })
      renderer.finish()

      const output = writeCalls.join("")
      expect(output).toContain("✓ model-00001.safetensors (1.0KB)")
      expect(output).toContain("done · 1 file · 1.0KB")
    })

    it("pluralizes files in finish milestone when multiple files downloaded", () => {
      const renderer = makeCliPullRenderer()
      renderer.onEvent({
        type: "end",
        file: "f1.bin",
        done: 1000,
        total: 1000,
        unit: "B"
      })
      renderer.onEvent({
        type: "end",
        file: "f2.bin",
        done: 2000,
        total: 2000,
        unit: "B"
      })
      renderer.finish()

      const output = writeCalls.join("")
      expect(output).toContain("done · 2 files · 2.9KB")
    })

    it("ignores error and non-byte progress events", () => {
      const renderer = makeCliPullRenderer()
      renderer.onEvent({ type: "error", message: "network fail" })
      renderer.onEvent({
        type: "progress",
        file: "f.bin",
        done: 1,
        total: 10,
        rate: null,
        elapsed: 1,
        unit: "items" as any
      })
      expect(writeCalls).toHaveLength(0)
    })
  })

  describe("TTY mode", () => {
    beforeEach(() => {
      Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true })
      Object.defineProperty(process.stdout, "columns", { value: 120, configurable: true })
    })

    it("renders dynamic progress line with bar, percent, and rate", () => {
      const renderer = makeCliPullRenderer()
      renderer.onEvent({
        type: "progress",
        file: "weights.safetensors",
        done: 50 * 1024 * 1024,
        total: 100 * 1024 * 1024,
        unit: "B",
        rate: 5 * 1024 * 1024,
        elapsed: 10
      })

      const output = writeCalls.join("")
      expect(output).toContain("\r")
      expect(output).toContain("downloading")
      expect(output).toContain("50.0%")
      expect(output).toContain("5.0MB/s")
      expect(output).toContain("weights.safetensors")
    })

    it("throttles paint unless forced", () => {
      const renderer = makeCliPullRenderer()
      renderer.onEvent({
        type: "progress",
        file: "file.bin",
        done: 100,
        total: 1000,
        unit: "B",
        rate: 50,
        elapsed: 2
      })
      const countAfterFirst = writeCalls.length

      // Immediate second progress event within 100ms should be throttled
      renderer.onEvent({
        type: "progress",
        file: "file.bin",
        done: 101,
        total: 1000,
        unit: "B",
        rate: 50,
        elapsed: 2
      })
      expect(writeCalls.length).toBe(countAfterFirst)

      // An 'end' event forces a repaint
      renderer.onEvent({
        type: "end",
        file: "file.bin",
        done: 1000,
        total: 1000,
        unit: "B"
      })
      expect(writeCalls.length).toBeGreaterThan(countAfterFirst)
    })

    it("renders finalizing state when done event is received", () => {
      const renderer = makeCliPullRenderer()
      renderer.onEvent({ type: "done", path: "/models/cache" })

      const output = writeCalls.join("")
      expect(output).toContain("finalizing…")
    })

    it("appends newline on finish in TTY mode", () => {
      const renderer = makeCliPullRenderer()
      renderer.onEvent({
        type: "progress",
        file: "weights.bin",
        done: 100,
        total: 100,
        rate: null,
        elapsed: 1,
        unit: "B"
      })
      writeCalls = []
      renderer.finish()

      expect(writeCalls).toContain("\n")
    })

    it("handles zero total size without NaN percentage", () => {
      const renderer = makeCliPullRenderer()
      renderer.onEvent({
        type: "progress",
        file: "empty.txt",
        done: 0,
        total: 0,
        rate: null,
        elapsed: 1,
        unit: "B"
      })

      const output = writeCalls.join("")
      expect(output).toContain("…")
      expect(output).not.toContain("NaN")
    })

    it("handles narrow terminal width gracefully", () => {
      Object.defineProperty(process.stdout, "columns", { value: 25, configurable: true })
      const renderer = makeCliPullRenderer()
      renderer.onEvent({
        type: "progress",
        file: "very-long-filename-that-exceeds-terminal-width.bin",
        done: 50,
        total: 100,
        rate: 10,
        elapsed: 5,
        unit: "B"
      })

      const lastCall = writeCalls[writeCalls.length - 1]
      expect(lastCall?.length).toBeLessThanOrEqual(26) // clamped to width
    })
  })
})
