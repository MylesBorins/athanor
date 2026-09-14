import React from "react"
import * as ink from "ink"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DownloadsModal, taskSummary } from "./DownloadsModal.js"
import type { DownloadTask } from "./useDownloads.js"

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

function task(overrides: Partial<DownloadTask> = {}): DownloadTask {
  return {
    id: "t1",
    repo: "owner/repo",
    file: undefined,
    status: "running",
    stageLabel: "downloading",
    currentFile: "",
    rate: null,
    errorLine: "",
    byteFiles: new Map([["a.bin", { done: 50, total: 100 }]]),
    createdAt: 0,
    updatedAt: 0,
    ...overrides
  }
}

describe("DownloadsModal taskSummary", () => {
  it("aggregates byte progress across files", () => {
    const summary = taskSummary(task({
      byteFiles: new Map([
        ["a.bin", { done: 50, total: 100 }],
        ["b.bin", { done: 100, total: 200 }]
      ])
    }))
    expect(summary.done).toBe(150)
    expect(summary.total).toBe(300)
    expect(summary.filesDone).toBe(0)
    expect(summary.filesTotal).toBe(2)
    expect(summary.frac).toBe(0.5)
  })

  it("counts completed files and handles unknown totals", () => {
    const summary = taskSummary(task({
      byteFiles: new Map([
        ["a.bin", { done: 100, total: 100 }],
        ["b.bin", { done: 25, total: null }]
      ])
    }))
    expect(summary.done).toBe(125)
    expect(summary.total).toBe(100)
    expect(summary.filesDone).toBe(1)
    expect(summary.filesTotal).toBe(2)
    expect(summary.frac).toBe(1.25)
  })
})

describe("DownloadsModal component rendering and interactions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("renders empty state when tasks is empty", () => {
    const onClose = vi.fn()
    const onCancelTask = vi.fn()
    const onClearFinished = vi.fn()

    const output = ink.renderToString(
      React.createElement(DownloadsModal, {
        tasks: [],
        onClose,
        onCancelTask,
        onClearFinished
      })
    )

    expect(output).toContain("Downloads")
    expect(output).toContain("No downloads yet.")

    const handler = useInputMock.mock.calls[0][0]
    handler("q", {})
    expect(onClose).toHaveBeenCalled()
  })

  it("renders multiple tasks in various states and handles key navigation", () => {
    const onClose = vi.fn()
    const onCancelTask = vi.fn()
    const onClearFinished = vi.fn()

    const tasks: DownloadTask[] = [
      task({
        id: "t1",
        repo: "org/model-a",
        file: "model.gguf",
        status: "running",
        stageLabel: "downloading",
        currentFile: "model.gguf",
        rate: 5 * 1024 * 1024,
        byteFiles: new Map([["model.gguf", { done: 50, total: 100 }]])
      }),
      task({
        id: "t2",
        repo: "org/model-b",
        status: "done",
        stageLabel: "completed",
        byteFiles: new Map(),
        resultMessage: "download finished"
      }),
      task({
        id: "t3",
        repo: "org/model-c",
        status: "error",
        stageLabel: "failed",
        errorLine: "network timed out",
        byteFiles: new Map()
      }),
      task({
        id: "t4",
        repo: "org/model-d",
        status: "cancelled",
        stageLabel: "cancelled",
        byteFiles: new Map()
      })
    ]

    const output = ink.renderToString(
      React.createElement(DownloadsModal, {
        tasks,
        width: 100,
        onClose,
        onCancelTask,
        onClearFinished
      })
    )

    expect(output).toContain("Downloads")
    expect(output).toContain("org/model-a")
    expect(output).toContain("org/model-b")
    expect(output).toContain("org/model-c")
    expect(output).toContain("org/model-d")
    expect(output).toContain("1 active · 1 done · 1 failed · 1 cancelled")
    expect(output).toContain("network timed out")

    const handler = useInputMock.mock.calls[0][0]

    // Cursor down
    handler("", { downArrow: true })
    // Cursor up
    handler("", { upArrow: true })

    // Cancel selected task
    handler("c", {})
    expect(onCancelTask).toHaveBeenCalledWith("t1")

    // Clear finished
    handler("C", {})
    expect(onClearFinished).toHaveBeenCalled()

    // Escape closes
    handler("", { escape: true })
    expect(onClose).toHaveBeenCalled()
  })
})
