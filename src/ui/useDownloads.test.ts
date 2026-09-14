import { describe, expect, it, vi } from "vitest"
import { PullAbortedError } from "../pull/download.js"
import {
  findActiveDuplicate,
  keepActiveTasks,
  markTaskFailure,
  markTaskSuccess,
  sameTarget,
  type DownloadTask
} from "./useDownloads.js"

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
    byteFiles: new Map(),
    createdAt: 0,
    updatedAt: 0,
    ...overrides
  }
}

describe("useDownloads helpers", () => {
  it("matches download targets by repo and file", () => {
    expect(sameTarget(task({ repo: "a/b", file: "x.gguf" }), { repo: "a/b", file: "x.gguf" })).toBe(true)
    expect(sameTarget(task({ repo: "a/b", file: undefined }), { repo: "a/b" })).toBe(true)
    expect(sameTarget(task({ repo: "a/b", file: "x.gguf" }), { repo: "a/b", file: "y.gguf" })).toBe(false)
  })

  it("finds active duplicate downloads but ignores completed ones", () => {
    const tasks = [
      task({ id: "done", status: "done", repo: "a/b", file: "x.gguf" }),
      task({ id: "active", status: "running", repo: "a/b", file: "x.gguf" }),
      task({ id: "other", status: "running", repo: "a/b", file: "y.gguf" })
    ]

    expect(findActiveDuplicate(tasks, { repo: "a/b", file: "x.gguf" })?.id).toBe("active")
    expect(findActiveDuplicate(tasks, { repo: "a/b", file: "z.gguf" })).toBeUndefined()
  })

  it("keeps only queued and running tasks when clearing finished", () => {
    const tasks = [
      task({ id: "queued", status: "queued" }),
      task({ id: "running", status: "running" }),
      task({ id: "done", status: "done" }),
      task({ id: "error", status: "error" }),
      task({ id: "cancelled", status: "cancelled" })
    ]

    expect(keepActiveTasks(tasks).map(t => t.id)).toEqual(["queued", "running"])
  })

  it("marks successful tasks as done with a result message", () => {
    const tasks = [task({ id: "a" }), task({ id: "b" })]
    const next = markTaskSuccess(tasks, "b", "pulled slug (port 8081)")
    expect(next[1]?.status).toBe("done")
    expect(next[1]?.stageLabel).toBe("done")
    expect(next[1]?.resultMessage).toContain("pulled slug")
  })

  it("marks generic failures as error with an error line", () => {
    const tasks = [task({ id: "a" })]
    const next = markTaskFailure(tasks, "a", new Error("boom"))
    expect(next[0]?.status).toBe("error")
    expect(next[0]?.stageLabel).toBe("error")
    expect(next[0]?.errorLine).toContain("pull failed: boom")
    expect(next[0]?.resultMessage).toContain("pull failed: boom")
  })

  it("marks aborted downloads as cancelled", () => {
    const tasks = [task({ id: "a" })]
    const next = markTaskFailure(tasks, "a", new PullAbortedError())
    expect(next[0]?.status).toBe("cancelled")
    expect(next[0]?.stageLabel).toBe("cancelled")
    expect(next[0]?.resultMessage).toBe("pull cancelled")
  })
})

describe("useDownloads hook lifecycle", () => {
  it("queues downloads, deduplicates, updates on events, and cancels", async () => {
    vi.resetModules()
    const React = await import("react")
    const ink = await import("ink")
    const { PassThrough } = await import("node:stream")

    let capturedOnEvent: any = null
    const mockPull = vi.fn((opts: any) => {
      capturedOnEvent = opts.onEvent
      return new Promise<{ entry: { slug: string; port: number } }>(() => {})
    })

    vi.doMock("../pull/hf.js", () => ({
      pull: mockPull
    }))

    const { useDownloads } = await import("./useDownloads.js")

    const hookRef = { current: null as any }
    function TestComponent() {
      hookRef.current = useDownloads()
      return React.createElement(
        ink.Text,
        null,
        `active: ${hookRef.current.activeCount}, tasks: ${hookRef.current.tasks.map((t: any) => `${t.id}:${t.stageLabel}:${t.currentFile}`).join(",")}`
      )
    }

    const stream = new PassThrough()
    const app = ink.render(React.createElement(TestComponent), { stdout: stream as any, stderr: stream as any, patchConsole: false })

    expect(hookRef.current.activeCount).toBe(0)

    // Queue download
    const t1 = hookRef.current.queueDownload({ repo: "mlx-community/Qwen2.5-32B", file: "model.safetensors" })
    expect(t1.repo).toBe("mlx-community/Qwen2.5-32B")

    // Queue duplicate: should immediately return same task without race condition
    const tDuplicate = hookRef.current.queueDownload({ repo: "mlx-community/Qwen2.5-32B", file: "model.safetensors" })
    expect(tDuplicate.id).toBe(t1.id)

    // Queue second download to test task.id !== id branches
    const t2 = hookRef.current.queueDownload({ repo: "mlx-community/Second" })
    expect(t2.id).not.toBe(t1.id)

    // Trigger events
    expect(capturedOnEvent).not.toBeNull()
    if (capturedOnEvent) {
      capturedOnEvent({ type: "start", unit: "items", file: "manifest.json" })
      capturedOnEvent({ type: "start", unit: "B", file: "model.safetensors", total: 1000 })
      capturedOnEvent({ type: "resolving", elapsed: 100 })
      // Omit total to exercise existing.total fallback
      capturedOnEvent({ type: "progress", unit: "B", file: "model.safetensors", done: 500, elapsed: 10, rate: 1024 })
      capturedOnEvent({ type: "error", message: "fail" })
      capturedOnEvent({ type: "done", elapsed: 200, path: "/tmp/snap" })
    }

    // Test onLine callback
    const onLineCb = mockPull.mock.calls[0]?.[0]?.onLine
    if (onLineCb) onLineCb("progress line update")

    // Force render pass to flush state updaters
    app.rerender(React.createElement(TestComponent))
    await new Promise(r => setTimeout(r, 60))

    // Cancel download
    hookRef.current.cancelDownload(t1.id)
    hookRef.current.cancelDownload("non-existent-id")
    app.rerender(React.createElement(TestComponent))
    await new Promise(r => setTimeout(r, 60))

    // Clear finished
    hookRef.current.clearFinished()
    app.rerender(React.createElement(TestComponent))
    await new Promise(r => setTimeout(r, 60))

    app.unmount()
  })

  it("handles pull success, abort, and failure callbacks", async () => {
    vi.resetModules()
    const { PullAbortedError: AbortedErr } = await import("../pull/download.js")
    const React = await import("react")
    const ink = await import("ink")
    const { PassThrough } = await import("node:stream")

    let outcome: "success" | "abort" | "error" | "string-error" = "success"
    const mockPull = vi.fn(async () => {
      if (outcome === "success") {
        return { entry: { slug: "success-slug", port: 8085 } }
      }
      if (outcome === "abort") {
        throw new AbortedErr()
      }
      if (outcome === "string-error") {
        throw "raw failure string"
      }
      throw new Error("failed download")
    })

    vi.doMock("../pull/hf.js", () => ({
      pull: mockPull
    }))

    const { useDownloads } = await import("./useDownloads.js")

    const onFinished = vi.fn()
    const hookRef = { current: null as any }
    function TestComponent() {
      hookRef.current = useDownloads(onFinished)
      return React.createElement(ink.Text, null, `active: ${hookRef.current.activeCount}`)
    }

    const stream = new PassThrough()
    const app = ink.render(React.createElement(TestComponent), { stdout: stream as any, stderr: stream as any, patchConsole: false })

    // Success case
    hookRef.current.queueDownload({ repo: "mlx-community/A" })
    await new Promise(r => setTimeout(r, 60))
    expect(onFinished).toHaveBeenCalledWith(expect.stringContaining("pulled success-slug"))

    // Abort case
    outcome = "abort"
    hookRef.current.queueDownload({ repo: "mlx-community/B" })
    await new Promise(r => setTimeout(r, 60))
    expect(onFinished).toHaveBeenCalledWith("pull cancelled")

    // Failure case with Error instance
    outcome = "error"
    hookRef.current.queueDownload({ repo: "mlx-community/C" })
    await new Promise(r => setTimeout(r, 60))
    expect(onFinished).toHaveBeenCalledWith(expect.stringContaining("pull failed: failed download"))

    // Failure case with string error
    outcome = "string-error"
    hookRef.current.queueDownload({ repo: "mlx-community/D" })
    await new Promise(r => setTimeout(r, 60))
    expect(onFinished).toHaveBeenCalledWith("pull failed: raw failure string")

    app.unmount()
  })
})


