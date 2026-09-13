import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

describe("runCli dispatcher", () => {
  let mockCommands: Record<string, ReturnType<typeof vi.fn>>
  let exitSpy: any
  let consoleLogSpy: any
  let consoleErrorSpy: any

  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()

    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`process.exit: ${code ?? 0}`)
    }) as any)

    mockCommands = {
      cmdConfig: vi.fn(),
      cmdDoctor: vi.fn(),
      cmdExpose: vi.fn(),
      cmdFlavor: vi.fn(),
      cmdFormulaApply: vi.fn(),
      cmdFormulaClear: vi.fn(),
      cmdFormulaSave: vi.fn(),
      cmdFormulaSet: vi.fn(),
      cmdFormulaShow: vi.fn(),
      cmdFormulaUnset: vi.fn(),
      cmdFormulas: vi.fn(),
      cmdFormulasDelete: vi.fn(),
      cmdList: vi.fn(),
      cmdLogs: vi.fn(),
      cmdPull: vi.fn(),
      cmdRestart: vi.fn(),
      cmdRm: vi.fn(),
      cmdRouter: vi.fn(),
      cmdScan: vi.fn(),
      cmdSearch: vi.fn(),
      cmdShow: vi.fn(),
      cmdSnippet: vi.fn(),
      cmdStart: vi.fn(),
      cmdStatus: vi.fn(),
      cmdStop: vi.fn(),
      cmdSync: vi.fn(),
      cmdTelemetry: vi.fn()
    }

    vi.doMock("./commands.js", () => mockCommands)
  })

  afterEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
    vi.doUnmock("./commands.js")
  })

  async function getRunner() {
    const { runCli } = await import("./index.js")
    return runCli
  }

  it("returns false when invoked with no arguments (TUI mode)", async () => {
    const runCli = await getRunner()
    expect(await runCli([])).toBe(false)
  })

  it("routes scan, ls, and status commands", async () => {
    const runCli = await getRunner()
    expect(await runCli(["scan"])).toBe(true)
    expect(mockCommands.cmdScan).toHaveBeenCalled()

    expect(await runCli(["ls"])).toBe(true)
    expect(mockCommands.cmdList).toHaveBeenCalled()

    expect(await runCli(["status"])).toBe(true)
    expect(mockCommands.cmdStatus).toHaveBeenCalled()
  })

  it("routes start and restart with required model argument and optional confirmation flag", async () => {
    const runCli = await getRunner()
    expect(await runCli(["start", "qwen-7b"])).toBe(true)
    expect(mockCommands.cmdStart).toHaveBeenCalledWith("qwen-7b", { yes: false })

    expect(await runCli(["start", "qwen-7b", "-y"])).toBe(true)
    expect(mockCommands.cmdStart).toHaveBeenCalledWith("qwen-7b", { yes: true })

    expect(await runCli(["start", "--yes", "qwen-7b"])).toBe(true)
    expect(mockCommands.cmdStart).toHaveBeenCalledWith("qwen-7b", { yes: true })

    expect(await runCli(["restart", "qwen-7b"])).toBe(true)
    expect(mockCommands.cmdRestart).toHaveBeenCalledWith("qwen-7b", { yes: false })

    expect(await runCli(["restart", "qwen-7b", "-y"])).toBe(true)
    expect(mockCommands.cmdRestart).toHaveBeenCalledWith("qwen-7b", { yes: true })

    expect(await runCli(["restart", "--yes", "qwen-7b"])).toBe(true)
    expect(mockCommands.cmdRestart).toHaveBeenCalledWith("qwen-7b", { yes: true })
  })

  it("exits with 1 when a required argument is missing", async () => {
    const runCli = await getRunner()
    await expect(runCli(["start"])).rejects.toThrow("process.exit: 1")
    expect(exitSpy).toHaveBeenCalledWith(1)
    expect(consoleErrorSpy).toHaveBeenCalled()
  })

  it("routes stop with and without model argument", async () => {
    const runCli = await getRunner()
    expect(await runCli(["stop"])).toBe(true)
    expect(mockCommands.cmdStop).toHaveBeenCalledWith(undefined)

    expect(await runCli(["stop", "qwen-7b"])).toBe(true)
    expect(mockCommands.cmdStop).toHaveBeenCalledWith("qwen-7b")
  })

  it("routes logs command with default and custom lines", async () => {
    const runCli = await getRunner()
    expect(await runCli(["logs", "qwen-7b"])).toBe(true)
    expect(mockCommands.cmdLogs).toHaveBeenCalledWith("qwen-7b", 200)

    expect(await runCli(["logs", "qwen-7b", "-n", "50"])).toBe(true)
    expect(mockCommands.cmdLogs).toHaveBeenCalledWith("qwen-7b", 50)

    expect(await runCli(["logs", "qwen-7b", "-n", "invalid"])).toBe(true)
    expect(mockCommands.cmdLogs).toHaveBeenCalledWith("qwen-7b", 200)
  })

  it("routes pull with optional file and revision flags", async () => {
    const runCli = await getRunner()
    expect(await runCli(["pull", "org/repo", "--file", "model.gguf", "--revision", "main"])).toBe(true)
    expect(mockCommands.cmdPull).toHaveBeenCalledWith("org/repo", "model.gguf", "main")
  })

  it("routes search and trending commands with flag parsing", async () => {
    const runCli = await getRunner()
    expect(await runCli(["search", "qwen", "--mlx", "--author", "mlx-community", "--sort", "likes", "--limit", "10"])).toBe(true)
    expect(mockCommands.cmdSearch).toHaveBeenCalledWith({
      query: "qwen",
      filter: "mlx",
      author: "mlx-community",
      sort: "likes",
      limit: 10
    })

    expect(await runCli(["trending", "--gguf", "--limit", "5"])).toBe(true)
    expect(mockCommands.cmdSearch).toHaveBeenCalledWith({
      query: undefined,
      filter: "gguf",
      author: undefined,
      sort: "trending",
      limit: 5
    })

    expect(await runCli(["search", "--any"])).toBe(true)
    expect(mockCommands.cmdSearch).toHaveBeenCalledWith(expect.objectContaining({ filter: "any" }))
  })

  it("routes show and snippet commands", async () => {
    const runCli = await getRunner()
    expect(await runCli(["show", "qwen-7b"])).toBe(true)
    expect(mockCommands.cmdShow).toHaveBeenCalledWith("qwen-7b")

    expect(await runCli(["snippet", "qwen-7b"])).toBe(true)
    expect(mockCommands.cmdSnippet).toHaveBeenCalledWith("qwen-7b")
  })

  it("routes formulas and recipes list and delete commands", async () => {
    const runCli = await getRunner()
    expect(await runCli(["formulas"])).toBe(true)
    expect(mockCommands.cmdFormulas).toHaveBeenCalled()

    expect(await runCli(["recipes", "delete", "f1"])).toBe(true)
    expect(mockCommands.cmdFormulasDelete).toHaveBeenCalledWith("f1")

    expect(await runCli(["formulas", "rm", "f2"])).toBe(true)
    expect(mockCommands.cmdFormulasDelete).toHaveBeenCalledWith("f2")
  })

  it("routes formula/preset subcommands: show, set, unset, clear, apply, save", async () => {
    const runCli = await getRunner()
    expect(await runCli(["formula", "qwen", "show"])).toBe(true)
    expect(mockCommands.cmdFormulaShow).toHaveBeenCalledWith("qwen")

    expect(await runCli(["formula", "qwen", "set", "temp=0.7", "top-p=0.9"])).toBe(true)
    expect(mockCommands.cmdFormulaSet).toHaveBeenCalledWith("qwen", ["temp=0.7", "top-p=0.9"])

    expect(await runCli(["formula", "qwen", "unset", "temp"])).toBe(true)
    expect(mockCommands.cmdFormulaUnset).toHaveBeenCalledWith("qwen", ["temp"])

    expect(await runCli(["preset", "qwen", "clear"])).toBe(true)
    expect(mockCommands.cmdFormulaClear).toHaveBeenCalledWith("qwen")

    expect(await runCli(["formula", "qwen", "apply", "balanced"])).toBe(true)
    expect(mockCommands.cmdFormulaApply).toHaveBeenCalledWith("qwen", "balanced")

    expect(await runCli(["formula", "qwen", "save", "custom", "my description"])).toBe(true)
    expect(mockCommands.cmdFormulaSave).toHaveBeenCalledWith("qwen", "custom", "my description")
  })

  it("routes prefix formula/preset subcommands (e.g. formula set <slug>)", async () => {
    const runCli = await getRunner()
    expect(await runCli(["formula", "show", "qwen"])).toBe(true)
    expect(mockCommands.cmdFormulaShow).toHaveBeenCalledWith("qwen")

    expect(await runCli(["formula", "set", "qwen", "temp=0.7"])).toBe(true)
    expect(mockCommands.cmdFormulaSet).toHaveBeenCalledWith("qwen", ["temp=0.7"])

    expect(await runCli(["formula", "unset", "qwen", "temp"])).toBe(true)
    expect(mockCommands.cmdFormulaUnset).toHaveBeenCalledWith("qwen", ["temp"])

    expect(await runCli(["formula", "clear", "qwen"])).toBe(true)
    expect(mockCommands.cmdFormulaClear).toHaveBeenCalledWith("qwen")

    expect(await runCli(["formula", "apply", "qwen", "balanced"])).toBe(true)
    expect(mockCommands.cmdFormulaApply).toHaveBeenCalledWith("qwen", "balanced")

    expect(await runCli(["formula", "save", "qwen", "custom"])).toBe(true)
    expect(mockCommands.cmdFormulaSave).toHaveBeenCalledWith("qwen", "custom", undefined)
  })

  it("exits with 1 on invalid formula subcommand", async () => {
    const runCli = await getRunner()
    await expect(runCli(["formula", "qwen", "unknown-sub"])).rejects.toThrow("process.exit: 1")
    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  it("routes expose, hide, flavor, rm, and sync commands", async () => {
    const runCli = await getRunner()
    expect(await runCli(["expose", "qwen"])).toBe(true)
    expect(mockCommands.cmdExpose).toHaveBeenCalledWith("qwen", true)

    expect(await runCli(["hide", "qwen"])).toBe(true)
    expect(mockCommands.cmdExpose).toHaveBeenCalledWith("qwen", false)

    expect(await runCli(["flavor", "qwen", "vlm"])).toBe(true)
    expect(mockCommands.cmdFlavor).toHaveBeenCalledWith("qwen", "vlm")

    expect(await runCli(["rm", "qwen"])).toBe(true)
    expect(mockCommands.cmdRm).toHaveBeenCalledWith("qwen")

    expect(await runCli(["sync"])).toBe(true)
    expect(mockCommands.cmdSync).toHaveBeenCalled()
  })

  it("routes router command with valid options and rejects invalid port", async () => {
    const runCli = await getRunner()
    expect(await runCli(["router", "--host", "0.0.0.0", "--port", "1234", "--verbose"])).toBe(true)
    expect(mockCommands.cmdRouter).toHaveBeenCalledWith({
      host: "0.0.0.0",
      port: 1234,
      verbose: true
    })

    await expect(runCli(["router", "--port", "abc"])).rejects.toThrow("process.exit: 1")
    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  it("routes config, doctor, and telemetry commands", async () => {
    const runCli = await getRunner()
    expect(await runCli(["config"])).toBe(true)
    expect(mockCommands.cmdConfig).toHaveBeenCalled()

    expect(await runCli(["doctor", "--check-updates"])).toBe(true)
    expect(mockCommands.cmdDoctor).toHaveBeenCalledWith({ checkUpdates: true })

    expect(await runCli(["telemetry", "compare"])).toBe(true)
    expect(mockCommands.cmdTelemetry).toHaveBeenCalledWith(["compare"])
  })

  it("renders usage on help flags", async () => {
    const runCli = await getRunner()
    expect(await runCli(["help"])).toBe(true)
    expect(await runCli(["--help"])).toBe(true)
    expect(await runCli(["-h"])).toBe(true)
    expect(consoleLogSpy).toHaveBeenCalled()
  })

  it("exits with 1 on unknown command", async () => {
    const runCli = await getRunner()
    await expect(runCli(["definitely-unknown-command"])).rejects.toThrow("process.exit: 1")
    expect(exitSpy).toHaveBeenCalledWith(1)
  })
})
