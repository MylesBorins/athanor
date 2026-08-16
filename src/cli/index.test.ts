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
      cmdPresetApply: vi.fn(),
      cmdPresetClear: vi.fn(),
      cmdPresetSave: vi.fn(),
      cmdPresetSet: vi.fn(),
      cmdPresetShow: vi.fn(),
      cmdPresetUnset: vi.fn(),
      cmdPull: vi.fn(),
      cmdRecipeDelete: vi.fn(),
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
      cmdSync: vi.fn(),
      cmdTelemetry: vi.fn()
    }))

    const { runCli } = await import("./index.js")
    await expect(runCli(["stop"])).resolves.toBe(true)
    expect(cmdStop).toHaveBeenCalledWith(undefined)
  })

  it("routes athanor formula <slug> show and athanor formulas delete <name>", async () => {
    const cmdFormulaShow = vi.fn()
    const cmdFormulasDelete = vi.fn()
    const cmdFormulas = vi.fn()

    vi.doMock("./commands.js", () => ({
      cmdConfig: vi.fn(),
      cmdDoctor: vi.fn(),
      cmdExpose: vi.fn(),
      cmdFlavor: vi.fn(),
      cmdFormulaApply: vi.fn(),
      cmdFormulaClear: vi.fn(),
      cmdFormulaSave: vi.fn(),
      cmdFormulaSet: vi.fn(),
      cmdFormulaShow,
      cmdFormulaUnset: vi.fn(),
      cmdFormulas,
      cmdFormulasDelete,
      cmdList: vi.fn(),
      cmdLogs: vi.fn(),
      cmdPresetApply: vi.fn(),
      cmdPresetClear: vi.fn(),
      cmdPresetSave: vi.fn(),
      cmdPresetSet: vi.fn(),
      cmdPresetShow: vi.fn(),
      cmdPresetUnset: vi.fn(),
      cmdPull: vi.fn(),
      cmdRecipeDelete: vi.fn(),
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
      cmdStop: vi.fn(),
      cmdSync: vi.fn(),
      cmdTelemetry: vi.fn()
    }))

    const { runCli } = await import("./index.js")
    await expect(runCli(["formula", "qwen-27b", "show"])).resolves.toBe(true)
    expect(cmdFormulaShow).toHaveBeenCalledWith("qwen-27b")

    await expect(runCli(["formulas", "delete", "custom-1"])).resolves.toBe(true)
    expect(cmdFormulasDelete).toHaveBeenCalledWith("custom-1")

    await expect(runCli(["formulas"])).resolves.toBe(true)
    expect(cmdFormulas).toHaveBeenCalled()
  })
})
