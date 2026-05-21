import { afterEach, describe, expect, it, vi } from "vitest"
import { cmdSearch } from "./system-commands.js"

vi.mock("../search/hf.js", () => ({
  HfSearchRateLimitError: class HfSearchRateLimitError extends Error {
    readonly status = 429
    readonly url: string
    constructor(url: string) {
      super(`HF search 429 for ${url}`)
      this.name = "HfSearchRateLimitError"
      this.url = url
    }
  },
  searchModels: vi.fn(),
  groupByRuntime: vi.fn(() => ({ mlx: [], gguf: [], other: [] }))
}))

import { HfSearchRateLimitError, searchModels } from "../search/hf.js"

describe("cmdSearch", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("prints a friendly hint for HF 429 rate limits in non-interactive mode", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {})
    const stdinTty = process.stdin.isTTY
    const stdoutTty = process.stdout.isTTY
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true })
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true })
    vi.mocked(searchModels).mockRejectedValue(new HfSearchRateLimitError("https://huggingface.co/api/models?filter=gguf"))

    try {
      await cmdSearch({ filter: "gguf", limit: 50 })
    } finally {
      Object.defineProperty(process.stdin, "isTTY", { value: stdinTty, configurable: true })
      Object.defineProperty(process.stdout, "isTTY", { value: stdoutTty, configurable: true })
    }

    const output = vi.mocked(console.log).mock.calls.map(args => String(args[0])).join("\n")
    expect(output).toContain("rate-limited")
    expect(output).toContain("lower --limit")
    expect(output).toContain("--mlx / --gguf")
  })
})
