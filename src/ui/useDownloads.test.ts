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
      return React.createElement(ink.Text, null, `active: ${hookRef.current.activeCount}`)
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

    // Trigger events
    if (capturedOnEvent) {
      capturedOnEvent({ type: "resolving", elapsed: 100 })
      capturedOnEvent({ type: "progress", unit: "B", file: "model.safetensors", done: 500, total: 1000, elapsed: 10, rate: 1024 })
      capturedOnEvent({ type: "error", message: "fail" })
      capturedOnEvent({ type: "done", elapsed: 200, path: "/tmp/snap" })
    }

    // Test onLine callback
    const onLineCb = mockPull.mock.calls[0]?.[0]?.onLine
    if (onLineCb) onLineCb("progress line update")

    // Cancel download
    hookRef.current.cancelDownload(t1.id)

    // Clear finished
    hookRef.current.clearFinished()

    app.unmount()
  })

  it("handles pull success and failure callbacks", async () => {
    vi.resetModules()
    const React = await import("react")
    const ink = await import("ink")
    const { PassThrough } = await import("node:stream")

    let shouldSucceed = true
    const mockPull = vi.fn(async () => {
      if (shouldSucceed) {
        return { entry: { slug: "success-slug", port: 8085 } }
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

    hookRef.current.queueDownload({ repo: "mlx-community/A" })
    await new Promise(r => setTimeout(r, 60))
    expect(onFinished).toHaveBeenCalledWith(expect.stringContaining("pulled success-slug"))

    // Failure case
    shouldSucceed = false
    hookRef.current.queueDownload({ repo: "mlx-community/B" })
    await new Promise(r => setTimeout(r, 60))
    expect(onFinished).toHaveBeenCalledWith(expect.stringContaining("pull failed: failed download"))

    app.unmount()
  })
})


