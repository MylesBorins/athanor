import React from "react"
import { PassThrough } from "node:stream"
import * as ink from "ink"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { type ProgressEvent } from "../pull/download.js"

const useInputMock = vi.fn()
vi.mock("ink", async () => {
  const actual = await vi.importActual<typeof import("ink")>("ink")
  return {
    ...actual,
    useInput: (handler: any, opts: any) => {
      useInputMock(handler, opts)
    }
  }
})

function getHandler(): (input: string, key: any) => void {
  const calls = useInputMock.mock.calls
  return calls[calls.length - 1][0]
}

describe("PullModal", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
    vi.doUnmock("../pull/hf.js")
  })

  it("renders in repo stage and advances to file stage on enter", async () => {
    const onDone = vi.fn()
    const onCancel = vi.fn()
    const { PullModal } = await import("./PullModal.js")

    const stream = new PassThrough()
    const app = ink.render(
      React.createElement(PullModal, { onDone, onCancel }),
      { stdout: stream as any, stderr: stream as any, patchConsole: false }
    )
    await new Promise(r => setTimeout(r, 40))

    // Return with empty repo check - should do nothing
    getHandler()("", { return: true })

    // Type with ctrl or meta key - should be ignored
    getHandler()("c", { ctrl: true })
    getHandler()("m", { meta: true })

    // Type "foo"
    getHandler()("f", {})
    getHandler()("o", {})
    getHandler()("o", {})
    await new Promise(r => setTimeout(r, 20))

    // Backspace
    getHandler()("", { backspace: true })
    await new Promise(r => setTimeout(r, 20))

    // Return advances to file stage
    getHandler()("", { return: true })
    await new Promise(r => setTimeout(r, 20))

    // Now in file stage, type "model.gguf"
    getHandler()("m", {})
    getHandler()("o", {})
    getHandler()("", { backspace: true })
    getHandler()("", { delete: true })
    getHandler()("x", {})
    await new Promise(r => setTimeout(r, 20))

    // Escape in file stage calls onCancel
    getHandler()("", { escape: true })
    expect(onCancel).toHaveBeenCalled()

    app.unmount()
  })

  it("advances from repo to file stage and starts pull on return", async () => {
    const mockPull = vi.fn(async () => ({ entry: { slug: "file-model", port: 8081 } }))
    vi.doMock("../pull/hf.js", () => ({ pull: mockPull }))

    const onDone = vi.fn()
    const onCancel = vi.fn()
    const { PullModal } = await import("./PullModal.js")

    const stream = new PassThrough()
    const app = ink.render(
      React.createElement(PullModal, { onDone, onCancel }),
      { stdout: stream as any, stderr: stream as any, patchConsole: false }
    )
    await new Promise(r => setTimeout(r, 40))

    // Enter repo
    getHandler()("m", {})
    getHandler()("y", {})
    getHandler()("-", {})
    getHandler()("r", {})
    await new Promise(r => setTimeout(r, 30))
    getHandler()("", { return: true })
    await new Promise(r => setTimeout(r, 30))

    // Enter file and press return
    getHandler()("f", {})
    getHandler()(".", {})
    getHandler()("g", {})
    await new Promise(r => setTimeout(r, 30))
    getHandler()("", { return: true })
    await new Promise(r => setTimeout(r, 40))

    expect(mockPull).toHaveBeenCalled()
    app.unmount()
  })

  it("allows escape in repo stage to call onCancel", async () => {
    const onDone = vi.fn()
    const onCancel = vi.fn()
    const { PullModal } = await import("./PullModal.js")

    const stream = new PassThrough()
    const app = ink.render(
      React.createElement(PullModal, { onDone, onCancel }),
      { stdout: stream as any, stderr: stream as any, patchConsole: false }
    )
    await new Promise(r => setTimeout(r, 40))

    getHandler()("", { escape: true })
    expect(onCancel).toHaveBeenCalled()

    app.unmount()
  })

  it("starts pull immediately when initialRepo is provided and renders progress bar and stats", async () => {
    let capturedOnEvent: ((ev: ProgressEvent) => void) | undefined
    let capturedOnLine: ((line: string) => void) | undefined
    const mockPull = vi.fn((opts: any) => {
      capturedOnEvent = opts.onEvent
      capturedOnLine = opts.onLine
      return new Promise<{ entry: { slug: string; port: number } }>(() => {})
    })

    vi.doMock("../pull/hf.js", () => ({
      pull: mockPull
    }))

    const onDone = vi.fn()
    const onCancel = vi.fn()
    const { PullModal } = await import("./PullModal.js")

    const stream = new PassThrough()
    const app = ink.render(
      React.createElement(PullModal, {
        onDone,
        onCancel,
        initialRepo: "mlx-community/Qwen3",
        initialFile: "test.gguf"
      }),
      { stdout: stream as any, stderr: stream as any, patchConsole: false }
    )
    await new Promise(r => setTimeout(r, 40))

    expect(mockPull).toHaveBeenCalled()
    expect(capturedOnEvent).toBeDefined()

    // Test resolving event
    capturedOnEvent!({ type: "resolving", repo: "mlx-community/Qwen2.5" })
    await new Promise(r => setTimeout(r, 20))

    // Test error event
    capturedOnEvent!({ type: "error", message: "network timeout" })
    await new Promise(r => setTimeout(r, 20))

    // Test files progress event (unit !== "B", ignored)
    capturedOnEvent!({ type: "progress", unit: "files", file: "total", done: 1, total: 2, elapsed: 10, rate: 0.1 })
    await new Promise(r => setTimeout(r, 20))

    // Test Byte progress event
    capturedOnEvent!({
      type: "progress",
      unit: "B",
      file: "weights.bin",
      done: 500 * 1024 * 1024,
      total: 1000 * 1024 * 1024,
      elapsed: 50,
      rate: 1024 * 1024 * 5
    })
    await new Promise(r => setTimeout(r, 20))

    // Test Byte completion event
    capturedOnEvent!({
      type: "progress",
      unit: "B",
      file: "weights.bin",
      done: 1000 * 1024 * 1024,
      total: 1000 * 1024 * 1024,
      elapsed: 100,
      rate: 1024 * 1024 * 10
    })
    await new Promise(r => setTimeout(r, 20))

    // Test done event
    capturedOnEvent!({ type: "done", path: "/tmp/model" })
    await new Promise(r => setTimeout(r, 20))

    if (capturedOnLine) capturedOnLine("error line text")
    await new Promise(r => setTimeout(r, 20))

    // Escape in running stage aborts the controller
    getHandler()("", { escape: true })

    app.unmount()
  })

  it("calls onDone with success message when pull resolves", async () => {
    vi.doMock("../pull/hf.js", () => ({
      pull: vi.fn(async () => ({ entry: { slug: "my-model", port: 8080 } }))
    }))

    const onDone = vi.fn()
    const onCancel = vi.fn()
    const { PullModal } = await import("./PullModal.js")

    const stream = new PassThrough()
    const app = ink.render(
      React.createElement(PullModal, {
        onDone,
        onCancel,
        initialRepo: "mlx-community/Qwen3"
      }),
      { stdout: stream as any, stderr: stream as any, patchConsole: false }
    )

    await new Promise(r => setTimeout(r, 40))
    expect(onDone).toHaveBeenCalledWith("pulled my-model (port 8080)")
    app.unmount()
  })

  it("calls onDone with cancellation message when PullAbortedError is thrown", async () => {
    const { PullAbortedError } = await import("../pull/download.js")
    vi.doMock("../pull/hf.js", () => ({
      pull: vi.fn(async () => {
        throw new PullAbortedError()
      })
    }))

    const onDone = vi.fn()
    const onCancel = vi.fn()
    const { PullModal } = await import("./PullModal.js")

    const stream = new PassThrough()
    const app = ink.render(
      React.createElement(PullModal, {
        onDone,
        onCancel,
        initialRepo: "mlx-community/Qwen3"
      }),
      { stdout: stream as any, stderr: stream as any, patchConsole: false }
    )

    await new Promise(r => setTimeout(r, 40))
    expect(onDone).toHaveBeenCalledWith("pull cancelled")
    app.unmount()
  })

  it("calls onDone with failure message on Error and non-Error objects", async () => {
    vi.doMock("../pull/hf.js", () => ({
      pull: vi.fn(async () => {
        throw new Error("failed to connect to host")
      })
    }))

    const onDone = vi.fn()
    const onCancel = vi.fn()
    const { PullModal } = await import("./PullModal.js")

    const stream = new PassThrough()
    const app = ink.render(
      React.createElement(PullModal, {
        onDone,
        onCancel,
        initialRepo: "mlx-community/Qwen3"
      }),
      { stdout: stream as any, stderr: stream as any, patchConsole: false }
    )

    await new Promise(r => setTimeout(r, 40))
    expect(onDone).toHaveBeenCalledWith("pull failed: failed to connect to host")
    app.unmount()
  })

  it("handles non-Error throw gracefully", async () => {
    vi.doMock("../pull/hf.js", () => ({
      pull: vi.fn(async () => {
        throw "string error message"
      })
    }))

    const onDone = vi.fn()
    const onCancel = vi.fn()
    const { PullModal } = await import("./PullModal.js")

    const stream = new PassThrough()
    const app = ink.render(
      React.createElement(PullModal, {
        onDone,
        onCancel,
        initialRepo: "mlx-community/Qwen3"
      }),
      { stdout: stream as any, stderr: stream as any, patchConsole: false }
    )

    await new Promise(r => setTimeout(r, 40))
    expect(onDone).toHaveBeenCalledWith("pull failed: string error message")
    app.unmount()
  })
})
