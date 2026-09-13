import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { cmdPull } from "./commands.js"
import { PullAbortedError } from "../pull/download.js"

vi.mock("../app/models.js", () => ({
  pullModel: vi.fn()
}))

vi.mock("./pull-renderer.js", () => ({
  makeCliPullRenderer: vi.fn(() => ({
    onEvent: vi.fn(),
    finish: vi.fn()
  }))
}))

import { pullModel } from "../app/models.js"

describe("cmdPull", () => {
  let logCalls: string[] = []

  beforeEach(() => {
    logCalls = []
    vi.spyOn(console, "log").mockImplementation((...args) => {
      logCalls.push(args.map(String).join(" "))
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("pulls a model and renders success message", async () => {
    vi.mocked(pullModel).mockResolvedValueOnce({
      entry: {
        id: "mlx-community/Qwen2.5-7B",
        slug: "qwen2-5-7b",
        runtime: "mlx",
        port: 8081
      } as any
    })

    await cmdPull("mlx-community/Qwen2.5-7B")
    const output = logCalls.join("\n")
    expect(output).toContain("pulled")
    expect(output).toContain("qwen2-5-7b")
    expect(output).toContain("8081")
  })

  it("aborts when receiving SIGINT", async () => {
    vi.mocked(pullModel).mockImplementationOnce(async ({ signal }: any) => {
      process.emit("SIGINT", "SIGINT")
      expect(signal?.aborted).toBe(true)
      throw new PullAbortedError()
    })
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit: 130")
    }) as any)

    await expect(cmdPull("mlx-community/Qwen2.5-7B")).rejects.toThrow("process.exit: 130")
    expect(exitSpy).toHaveBeenCalledWith(130)
    const output = logCalls.join("\n")
    expect(output).toContain("cancelling pull")
  })

  it("handles PullAbortedError by warning and exiting with code 130", async () => {
    vi.mocked(pullModel).mockRejectedValueOnce(new PullAbortedError())
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit: 130")
    }) as any)

    await expect(cmdPull("mlx-community/Qwen2.5-7B")).rejects.toThrow("process.exit: 130")
    expect(exitSpy).toHaveBeenCalledWith(130)
    const output = logCalls.join("\n")
    expect(output).toContain("pull cancelled")
  })

  it("rethrows any unexpected non-abort errors", async () => {
    vi.mocked(pullModel).mockRejectedValueOnce(new Error("network failure"))
    await expect(cmdPull("mlx-community/Qwen2.5-7B")).rejects.toThrow("network failure")
  })

  it("cleans up signal listeners upon completion", async () => {
    const initialIntListeners = process.listenerCount("SIGINT")
    const initialTermListeners = process.listenerCount("SIGTERM")

    vi.mocked(pullModel).mockResolvedValueOnce({
      entry: {
        id: "mlx-community/Qwen2.5-7B",
        slug: "qwen2-5-7b",
        runtime: "mlx",
        port: 8081
      } as any
    })

    await cmdPull("mlx-community/Qwen2.5-7B")
    expect(process.listenerCount("SIGINT")).toBe(initialIntListeners)
    expect(process.listenerCount("SIGTERM")).toBe(initialTermListeners)
  })
})
