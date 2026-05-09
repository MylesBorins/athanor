import { describe, expect, it } from "vitest"
import { taskSummary } from "./DownloadsModal.js"
import type { DownloadTask } from "./useDownloads.js"

function task(byteFiles: Array<[string, { done: number; total: number | null }]>): DownloadTask {
  return {
    id: "t1",
    repo: "owner/repo",
    file: undefined,
    status: "running",
    stageLabel: "downloading",
    currentFile: "",
    rate: null,
    errorLine: "",
    byteFiles: new Map(byteFiles),
    createdAt: 0,
    updatedAt: 0
  }
}

describe("DownloadsModal taskSummary", () => {
  it("aggregates byte progress across files", () => {
    const summary = taskSummary(task([
      ["a.bin", { done: 50, total: 100 }],
      ["b.bin", { done: 100, total: 200 }]
    ]))
    expect(summary.done).toBe(150)
    expect(summary.total).toBe(300)
    expect(summary.filesDone).toBe(0)
    expect(summary.filesTotal).toBe(2)
    expect(summary.frac).toBe(0.5)
  })

  it("counts completed files and handles unknown totals", () => {
    const summary = taskSummary(task([
      ["a.bin", { done: 100, total: 100 }],
      ["b.bin", { done: 25, total: null }]
    ]))
    expect(summary.done).toBe(125)
    expect(summary.total).toBe(100)
    expect(summary.filesDone).toBe(1)
    expect(summary.filesTotal).toBe(2)
    expect(summary.frac).toBe(1.25)
  })
})
