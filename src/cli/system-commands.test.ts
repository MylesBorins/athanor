import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cmdConfig, cmdDoctor, cmdRouter, cmdSearch } from "./system-commands.js"

const mockRender = vi.fn()
vi.mock("ink", () => ({
  render: (...args: any[]) => mockRender(...args)
}))

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
  groupByRuntime: vi.fn((results: any[]) => {
    return {
      mlx: results.filter(r => r.runtime === "mlx"),
      gguf: results.filter(r => r.runtime === "llama.cpp"),
      other: results.filter(r => !r.runtime)
    }
  })
}))

vi.mock("../search/recommend.js", () => ({
  buildSearchRecommendation: vi.fn(() => ({ fit: "comfortable", estimatedVramBytes: 1000 })),
  sortByFit: vi.fn((results: any[]) => results)
}))

vi.mock("../search/format.js", () => ({
  formatResultRow: vi.fn((r: any) => `${r.id} (row)`)
}))

vi.mock("../router/server.js", () => ({
  startRouter: vi.fn(),
  stopRouter: vi.fn(async () => {})
}))

vi.mock("../registry/index.js", () => ({
  listModels: vi.fn(() => [
    { id: "m1", publish: true },
    { id: "m2", publish: false }
  ])
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
import { sortByFit } from "../search/recommend.js"
import { startRouter, stopRouter } from "../router/server.js"

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
  let stdinTty: boolean | undefined
  let stdoutTty: boolean | undefined

  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {})
    stdinTty = process.stdin.isTTY
    stdoutTty = process.stdout.isTTY
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true })
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true })
  })

  afterEach(() => {
    Object.defineProperty(process.stdin, "isTTY", { value: stdinTty, configurable: true })
    Object.defineProperty(process.stdout, "isTTY", { value: stdoutTty, configurable: true })
    vi.restoreAllMocks()
  })

  it("prints a friendly hint for HF 429 rate limits in non-interactive mode", async () => {
    vi.mocked(searchModels).mockRejectedValue(new HfSearchRateLimitError("https://huggingface.co/api/models?filter=gguf"))

    await cmdSearch({ filter: "gguf", limit: 50 })

    const output = vi.mocked(console.log).mock.calls.map(args => String(args[0])).join("\n")
    expect(output).toContain("rate-limited")
    expect(output).toContain("lower --limit")
    expect(output).toContain("--mlx / --gguf")
  })

  it("prints warning when no search results are found", async () => {
    vi.mocked(searchModels).mockResolvedValueOnce([])

    await cmdSearch({ query: "nonexistent-model" })

    const output = vi.mocked(console.log).mock.calls.map(args => String(args[0])).join("\n")
    expect(output).toContain("no results")
  })

  it("renders grouped results across MLX, GGUF, and other with next steps", async () => {
    vi.mocked(searchModels).mockResolvedValueOnce([
      { id: "mlx-org/model-1", runtime: "mlx" },
      { id: "gguf-org/model-2", runtime: "llama.cpp" },
      { id: "raw-org/model-3" }
    ] as any)

    await cmdSearch({ query: "qwen", sort: "fit" })

    expect(sortByFit).toHaveBeenCalled()
    const output = vi.mocked(console.log).mock.calls.map(args => String(args[0])).join("\n")
    expect(output).toContain("MLX")
    expect(output).toContain("GGUF")
    expect(output).toContain("other")
    expect(output).toContain("mlx-org/model-1 (row)")
    expect(output).toContain("next:")
    expect(output).toContain("athanor pull <repo>")
  })

  it("rethrows non-rate-limit errors", async () => {
    vi.mocked(searchModels).mockRejectedValueOnce(new Error("network failure"))
    await expect(cmdSearch({ query: "test" })).rejects.toThrow("network failure")
  })

  it("runs interactive TUI SearchBrowser when stdin and stdout are TTYs", async () => {
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true })
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true })

    const stdoutWrites: string[] = []
    vi.spyOn(process.stdout, "write").mockImplementation((str: any) => {
      stdoutWrites.push(String(str))
      return true
    })

    mockRender.mockImplementationOnce((elem: any, _opts: any) => {
      // Simulate onExit callback
      elem.props.onExit("successfully pulled test-model")
      return {
        waitUntilExit: vi.fn().mockResolvedValue(undefined)
      }
    })

    await cmdSearch({ query: "qwen", filter: "mlx", sort: "downloads" })

    expect(mockRender).toHaveBeenCalledTimes(1)
    const [renderElem, renderOpts] = mockRender.mock.calls[0]
    expect(renderOpts).toEqual({ exitOnCtrlC: true })
    expect(renderElem.props.initialQuery).toBe("qwen")
    expect(renderElem.props.initialFilter).toBe("mlx")
    expect(renderElem.props.initialSort).toBe("downloads")

    // Verify alt screen enter/leave and cursor hide/show escape sequences
    const fullStdout = stdoutWrites.join("")
    expect(fullStdout).toContain("\x1b[?1049h\x1b[?25l") // enter alt screen + hide cursor
    expect(fullStdout).toContain("\x1b[?25h\x1b[?1049l") // show cursor + leave alt screen

    // Verify final message was logged
    const logOutput = vi.mocked(console.log).mock.calls.map(args => String(args[0])).join("\n")
    expect(logOutput).toContain("successfully pulled test-model")
  })
})

describe("cmdRouter", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("throws error when router is already running in process", async () => {
    vi.mocked(startRouter).mockReturnValueOnce(null as any)

    await expect(cmdRouter({ host: "127.0.0.1", port: 40879 })).rejects.toThrow(
      "router already running in this process"
    )
  })

  it("starts router and shuts down gracefully on SIGINT", async () => {
    vi.mocked(startRouter).mockReturnValueOnce({} as any)

    const routerPromise = cmdRouter({ host: "127.0.0.1", port: 40879, verbose: true })
    // Emit SIGINT to trigger clean stop
    process.emit("SIGINT", "SIGINT")
    await routerPromise

    expect(startRouter).toHaveBeenCalledWith({
      host: "127.0.0.1",
      port: 40879,
      force: true,
      silent: true,
      verbose: true
    })
    expect(stopRouter).toHaveBeenCalled()
    const output = vi.mocked(console.log).mock.calls.map(args => String(args[0])).join("\n")
    expect(output).toContain("athanor router listening on http://127.0.0.1:40879")
    expect(output).toContain("exposed models: 1")
  })
})
