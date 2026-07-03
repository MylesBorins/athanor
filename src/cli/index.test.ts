import { afterEach, describe, expect, it, vi } from "vitest"

describe("runCli", () => {
  afterEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
    vi.doUnmock("./commands.js")
    vi.doUnmock("./style.js")
  })

  it("passes through bare stop so the command can handle its legacy all-models behavior", async () => {
    const cmdStop = vi.fn()

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

    const { runCli } = await import("./index.js")
    await expect(runCli(["stop"])).resolves.toBe(true)
    expect(cmdStop).toHaveBeenCalledWith(undefined)
  })
})
