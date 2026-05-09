import { describe, expect, it } from "vitest"
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
