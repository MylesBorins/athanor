import { afterEach, describe, expect, it, vi } from "vitest"

describe("runCli", () => {
  afterEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
    vi.doUnmock("./commands.js")
    vi.doUnmock("./style.js")
  })

  it("requires an explicit id or --all for stop", async () => {
    const cmdStop = vi.fn()
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit")
    }) as never)

    vi.doMock("./commands.js", () => ({
      cmdConfig: vi.fn(),
      cmdDoctor: vi.fn(),
      cmdExpose: vi.fn(),
      cmdFlavor: vi.fn(),
      cmdList: vi.fn(),
      cmdLogs: vi.fn(),
      cmdPresetApply: vi.fn(),
      cmdPresetClear: vi.fn(),
      cmdPresetSet: vi.fn(),
      cmdPresetShow: vi.fn(),
      cmdPresetUnset: vi.fn(),
      cmdPull: vi.fn(),
      cmdRecipes: vi.fn(),
      cmdRestart: vi.fn(),
      cmdRm: vi.fn(),
      cmdRouter: vi.fn(),
      cmdScan: vi.fn(),
      cmdSearch: vi.fn(),
      cmdShow: vi.fn(),
      cmdSnippet: vi.fn(),
      cmdStart: vi.fn(),
      cmdStatus: vi.fn(),
      cmdStop,
      cmdSync: vi.fn()
    }))
    vi.doMock("./style.js", () => ({
      style: { red: (s: string) => s, bold: (s: string) => s, cyan: (s: string) => s, gray: (s: string) => s }
    }))

    const { runCli } = await import("./index.js")
    await expect(runCli(["stop"]))
      .rejects.toThrow("process.exit")
    expect(cmdStop).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalledWith(expect.stringContaining("missing required argument: id|slug|--all"))
    expect(exit).toHaveBeenCalledWith(1)
  })
})
