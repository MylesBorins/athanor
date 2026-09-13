import { afterEach, describe, expect, it, vi } from "vitest"
import { cmdConfig, cmdDoctor, cmdSearch } from "./system-commands.js"

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

vi.mock("./doctor.js", () => ({
  which: vi.fn(async (b: string) => (b === "llama-server" ? null : `/mock/bin/${b}`)),
  binaryVersion: vi.fn(async (b: string) => (b === "mlx_lm.server" ? "0.21.0" : null)),
  binaryUpdateStatus: vi.fn(async (b: string) => (
    b === "mlx_lm.server"
      ? { latest: "0.22.0", outdated: true, hint: "uv tool upgrade mlx-lm" }
      : null
  ))
}))

import { HfSearchRateLimitError, searchModels } from "../search/hf.js"

describe("cmdConfig", () => {
  it("prints config path and formatted json", () => {
    vi.spyOn(console, "log").mockImplementation(() => {})
    cmdConfig()
    const output = vi.mocked(console.log).mock.calls.map(args => String(args[0])).join("\n")
    expect(output).toContain("config")
    expect(output).toContain("portRange")
  })
})

describe("cmdDoctor", () => {
  it("prints binaries table and paths without update checks", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {})
    await cmdDoctor()
    const output = vi.mocked(console.log).mock.calls.map(args => String(args[0])).join("\n")
    expect(output).toContain("mlx_lm.server")
    expect(output).toContain("llama-server")
    expect(output).toContain("NOT FOUND")
    expect(output).toContain("0.21.0")
    expect(output).toContain("paths")
    expect(output).toContain("logs")
  })

  it("prints update statuses and hints when checkUpdates is true", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {})
    await cmdDoctor({ checkUpdates: true })
    const output = vi.mocked(console.log).mock.calls.map(args => String(args[0])).join("\n")
    expect(output).toContain("update available")
    expect(output).toContain("hint uv tool upgrade mlx-lm")
  })
})

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
