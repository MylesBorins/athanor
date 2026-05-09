import { describe, expect, it } from "vitest"
import { findActiveDuplicate, keepActiveTasks, sameTarget, type DownloadTask } from "./useDownloads.js"

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
})
