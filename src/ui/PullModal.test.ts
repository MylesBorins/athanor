import React from "react"
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

    const output1 = ink.renderToString(
      React.createElement(PullModal, { onDone, onCancel })
    )
    expect(output1).toContain("Pull from HuggingFace")
    expect(output1).toContain("<org>/<name>")

    const handler = useInputMock.mock.calls[0][0]

    // Type "foo"
    handler("f", {})
    handler("o", {})
    handler("o", {})

    // Backspace
    handler("", { backspace: true })

    // Return with empty check (if it was empty) vs valid text
    handler("", { return: true })

    // Now in file stage, type "model.gguf"
    handler("m", {})
    handler("o", {})
    handler("", { backspace: true })
    handler("", { delete: true })
    handler("x", {})

    // Return in file stage starts pull
    handler("", { return: true })

    // Escape in file stage calls onCancel
    handler("", { escape: true })
    expect(onCancel).toHaveBeenCalled()
  })

  it("starts pull immediately when initialRepo is provided and handles events", async () => {
    let capturedOnEvent: ((ev: ProgressEvent) => void) | undefined
    let capturedOnLine: ((line: string) => void) | undefined
    const mockPull = vi.fn((opts: any) => {
      capturedOnEvent = opts.onEvent
      capturedOnLine = opts.onLine
      return new Promise<{ entry: { slug: string; port: number } }>(() => {}) // never resolves immediately
    })

    vi.doMock("../pull/hf.js", () => ({
      pull: mockPull
    }))

    const onDone = vi.fn()
    const onCancel = vi.fn()
    const { PullModal } = await import("./PullModal.js")

    ink.renderToString(
      React.createElement(PullModal, {
        onDone,
        onCancel,
        initialRepo: "mlx-community/Qwen3",
        initialFile: "test.gguf"
      })
    )

    expect(mockPull).toHaveBeenCalled()
    expect(capturedOnEvent).toBeDefined()

    // Test events
    capturedOnEvent!({ type: "resolving", repo: "mlx-community/Qwen2.5" })
    capturedOnEvent!({ type: "done", path: "/tmp/model" })
    capturedOnEvent!({ type: "error", message: "network timeout" })
    capturedOnEvent!({ type: "progress", unit: "files", file: "total", done: 1, total: 2, elapsed: 10, rate: 0.1 })
    capturedOnEvent!({ type: "progress", unit: "B", file: "weights.bin", done: 500, total: 1000, elapsed: 50, rate: 1024 * 1024 * 5 })
    capturedOnEvent!({ type: "progress", unit: "B", file: "weights.bin", done: 1000, total: 1000, elapsed: 100, rate: 1024 * 1024 * 10 })

    if (capturedOnLine) capturedOnLine("error line text")

    // Escape in running stage aborts the controller
    const handler = useInputMock.mock.calls[0][0]
    handler("", { escape: true })
  })

  it("calls onDone with success message when pull resolves", async () => {
    vi.doMock("../pull/hf.js", () => ({
      pull: vi.fn(async () => ({ entry: { slug: "my-model", port: 8080 } }))
    }))

    const onDone = vi.fn()
    const onCancel = vi.fn()
    const { PullModal } = await import("./PullModal.js")

    ink.renderToString(
      React.createElement(PullModal, {
        onDone,
        onCancel,
        initialRepo: "mlx-community/Qwen3"
      })
    )

    await Promise.resolve()
    await Promise.resolve()
    expect(onDone).toHaveBeenCalledWith("pulled my-model (port 8080)")
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

    ink.renderToString(
      React.createElement(PullModal, {
        onDone,
        onCancel,
        initialRepo: "mlx-community/Qwen3"
      })
    )

    await Promise.resolve()
    await Promise.resolve()
    expect(onDone).toHaveBeenCalledWith("pull cancelled")
  })

  it("calls onDone with failure message on generic error", async () => {
    vi.doMock("../pull/hf.js", () => ({
      pull: vi.fn(async () => {
        throw new Error("failed to connect to host")
      })
    }))

    const onDone = vi.fn()
    const onCancel = vi.fn()
    const { PullModal } = await import("./PullModal.js")

    ink.renderToString(
      React.createElement(PullModal, {
        onDone,
        onCancel,
        initialRepo: "mlx-community/Qwen3"
      })
    )

    await Promise.resolve()
    await Promise.resolve()
    expect(onDone).toHaveBeenCalledWith("pull failed: failed to connect to host")
  })
})
