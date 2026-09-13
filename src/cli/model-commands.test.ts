import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import {
  cmdExpose,
  cmdFlavor,
  cmdList,
  cmdLogs,
  cmdRestart,
  cmdRm,
  cmdScan,
  cmdShow,
  cmdStart,
  cmdStatus,
  cmdStop,
  cmdSync
} from "./model-commands.js"
import type { ModelEntry, ActiveInstance } from "../types/index.js"

vi.mock("../app/models.js", () => ({
  scanModelsAndReport: vi.fn(),
  deleteModelFromDisk: vi.fn(),
  restartModel: vi.fn(),
  setFlavor: vi.fn(),
  setPublished: vi.fn(),
  startModel: vi.fn(),
  stopModel: vi.fn(),
  syncPiNow: vi.fn()
}))

vi.mock("../registry/index.js", () => ({
  listModels: vi.fn(() => []),
  getModel: vi.fn()
}))

vi.mock("../supervisor/index.js", () => ({
  supervisor: {
    ready: vi.fn(async () => {}),
    list: vi.fn(() => [])
  }
}))

vi.mock("../supervisor/state.js", () => ({
  getPersistedRouter: vi.fn(() => undefined),
  pidAlive: vi.fn(() => false)
}))

vi.mock("../supervisor/logs.js", () => ({
  tailLog: vi.fn(() => "line 1\nline 2\nline 3\n")
}))

vi.mock("../supervisor/metrics.js", () => ({
  sampleProcessStats: vi.fn(() => new Map()),
  parseCompletionStats: vi.fn(() => ({ tokPerSec: 32.5 })),
  getLiveRouterStats: vi.fn(() => null)
}))

vi.mock("../machine/profile.js", () => ({
  detectMachineProfile: vi.fn(() => ({
    totalMemoryBytes: 32 * 1024 ** 3,
    totalMemoryGiB: 32,
    chip: "Apple M4 Max"
  }))
}))

import {
  scanModelsAndReport,
  deleteModelFromDisk,
  restartModel,
  setFlavor,
  setPublished,
  startModel,
  stopModel,
  syncPiNow
} from "../app/models.js"
import { listModels, getModel } from "../registry/index.js"
import { supervisor } from "../supervisor/index.js"
import { getPersistedRouter, pidAlive } from "../supervisor/state.js"
import { tailLog } from "../supervisor/logs.js"

function makeModel(overrides: Partial<ModelEntry> = {}): ModelEntry {
  return {
    id: "mlx-community/Qwen2.5-7B",
    slug: "qwen2-5-7b",
    path: "/models/qwen",
    runtime: "mlx",
    source: { type: "hf", repo: "mlx-community/Qwen2.5-7B" },
    port: 8081,
    publish: true,
    addedAt: 100,
    ...overrides
  }
}

function makeInstance(overrides: Partial<ActiveInstance> = {}): ActiveInstance {
  return {
    id: "mlx-community/Qwen2.5-7B",
    slug: "qwen2-5-7b",
    runtime: "mlx",
    port: 8081,
    pid: 12345,
    startedAt: Date.now() - 60000,
    status: "running",
    logFile: "/tmp/qwen.log",
    spawnStartedAt: Date.now() - 62000,
    healthyAt: Date.now() - 60000,
    ...overrides
  }
}

describe("model-commands", () => {
  let logCalls: string[] = []

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(supervisor.list).mockReturnValue([])
    vi.mocked(listModels).mockReturnValue([])
    vi.mocked(getModel).mockReturnValue(undefined)
    vi.mocked(tailLog).mockReturnValue("line 1\nline 2\nline 3")
    logCalls = []
    vi.spyOn(console, "log").mockImplementation((...args) => {
      logCalls.push(args.map(String).join(" "))
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe("cmdScan", () => {
    it("reports added, path-updated, and unchanged counts", async () => {
      vi.mocked(scanModelsAndReport).mockReturnValueOnce({
        added: [makeModel()],
        updatedPath: [],
        unchanged: 3
      })

      await cmdScan()
      const output = logCalls.join("\n")
      expect(output).toContain("scan complete")
      expect(output).toContain("+1 new")
      expect(output).toContain("3 unchanged")
      expect(output).toContain("qwen2-5-7b")
    })
  })

  describe("cmdList", () => {
    it("prints starter suggestions when registry is empty", async () => {
      vi.mocked(listModels).mockReturnValueOnce([])
      vi.mocked(supervisor.list).mockReturnValueOnce([])

      await cmdList()
      const output = logCalls.join("\n")
      expect(output).toContain("registry empty")
      expect(output).toContain("athanor pull")
    })

    it("prints formatted model list when models are registered", async () => {
      vi.mocked(listModels).mockReturnValueOnce([makeModel()])
      vi.mocked(supervisor.list).mockReturnValueOnce([makeInstance()])

      await cmdList()
      const output = logCalls.join("\n")
      expect(output).toContain("1 model")
      expect(output).toContain("qwen2-5-7b")
    })
  })

  describe("cmdStatus", () => {
    it("prints 'no running instances' when nothing is running and router is absent", async () => {
      vi.mocked(supervisor.list).mockReturnValueOnce([])
      vi.mocked(getPersistedRouter).mockReturnValueOnce(undefined)

      await cmdStatus()
      const output = logCalls.join("\n")
      expect(output).toContain("no running instances")
    })

    it("reports router status when router is up even if instances are empty", async () => {
      vi.mocked(supervisor.list).mockReturnValueOnce([])
      vi.mocked(getPersistedRouter).mockReturnValueOnce({ pid: 9999, host: "127.0.0.1", port: 40879, startedAt: 123456 })
      vi.mocked(pidAlive).mockReturnValueOnce(true)

      await cmdStatus()
      const output = logCalls.join("\n")
      expect(output).toContain("router up")
      expect(output).toContain("pid=9999")
    })

    it("prints detailed metrics for running instances", async () => {
      vi.mocked(supervisor.list).mockReturnValueOnce([makeInstance()])
      vi.mocked(getPersistedRouter).mockReturnValueOnce(undefined)

      await cmdStatus()
      const output = logCalls.join("\n")
      expect(output).toContain("1 running")
      expect(output).toContain("qwen2-5-7b")
      expect(output).toContain("8081")
    })
  })

  describe("cmdStart", () => {
    it("starts model and reports pid and port", async () => {
      vi.mocked(startModel).mockResolvedValueOnce({
        entry: makeModel(),
        instance: makeInstance({ pid: 2468, port: 8081 }),
        warned: false
      })

      await cmdStart("qwen2-5-7b")
      const output = logCalls.join("\n")
      expect(output).toContain("started qwen2-5-7b")
      expect(output).toContain("pid=2468")
    })

    it("passes confirm: true when yes option is enabled", async () => {
      vi.mocked(startModel).mockResolvedValueOnce({
        entry: makeModel(),
        instance: makeInstance({ pid: 2468 }),
        warned: false
      })

      await cmdStart("qwen2-5-7b", { yes: true })
      expect(startModel).toHaveBeenCalledWith("qwen2-5-7b", { confirm: true })
    })

    it("throws when starting returns no instance", async () => {
      vi.mocked(startModel).mockResolvedValueOnce({
        entry: makeModel(),
        instance: undefined,
        warned: false
      })

      await expect(cmdStart("qwen2-5-7b")).rejects.toThrow("failed to start qwen2-5-7b")
    })
  })

  describe("cmdStop", () => {
    it("reports stopped model name", async () => {
      vi.mocked(stopModel).mockResolvedValueOnce({
        stopped: true,
        stoppedAll: false,
        entry: makeModel()
      })

      await cmdStop("qwen2-5-7b")
      const output = logCalls.join("\n")
      expect(output).toContain("stopped qwen2-5-7b")
    })

    it("reports when model was not running", async () => {
      vi.mocked(stopModel).mockResolvedValueOnce({
        stopped: false,
        stoppedAll: false,
        entry: makeModel()
      })

      await cmdStop("qwen2-5-7b")
      const output = logCalls.join("\n")
      expect(output).toContain("was not running")
    })

    it("reports 'no running instances to stop' when stopAll has nothing to stop", async () => {
      vi.mocked(stopModel).mockResolvedValueOnce({
        stopped: false,
        stoppedAll: true
      })

      await cmdStop(undefined)
      const output = logCalls.join("\n")
      expect(output).toContain("no running instances to stop")
    })
  })

  describe("cmdRestart", () => {
    it("restarts model and reports pid", async () => {
      vi.mocked(restartModel).mockResolvedValueOnce({
        entry: makeModel(),
        instance: makeInstance({ pid: 5678 }),
        warned: false
      })

      await cmdRestart("qwen2-5-7b")
      const output = logCalls.join("\n")
      expect(output).toContain("restarted qwen2-5-7b")
      expect(output).toContain("pid=5678")
    })

    it("passes confirm: true when yes option is enabled", async () => {
      vi.mocked(restartModel).mockResolvedValueOnce({
        entry: makeModel(),
        instance: makeInstance({ pid: 5678 }),
        warned: false
      })

      await cmdRestart("qwen2-5-7b", { yes: true })
      expect(restartModel).toHaveBeenCalledWith("qwen2-5-7b", { confirm: true })
    })
  })

  describe("cmdLogs", () => {
    it("prints last N lines from running model's log file", async () => {
      vi.mocked(supervisor.list).mockReturnValueOnce([makeInstance()])
      vi.mocked(tailLog).mockReturnValueOnce("line 1\nline 2\nline 3")

      await cmdLogs("qwen2-5-7b", 2)
      const output = logCalls.join("\n")
      expect(output).toContain("line 2")
      expect(output).toContain("line 3")
    })

    it("warns when model is registered but not currently running", async () => {
      vi.mocked(supervisor.list).mockReturnValueOnce([])
      vi.mocked(getModel).mockReturnValueOnce(makeModel())

      await cmdLogs("qwen2-5-7b")
      const output = logCalls.join("\n")
      expect(output).toContain("no running instance; no log available")
    })

    it("throws on unknown model", async () => {
      vi.mocked(supervisor.list).mockReturnValueOnce([])
      vi.mocked(getModel).mockReturnValueOnce(undefined)

      await expect(cmdLogs("nonexistent")).rejects.toThrow("unknown model: nonexistent")
    })
  })

  describe("cmdExpose", () => {
    it("updates and prints exposed / hidden state", () => {
      vi.mocked(setPublished).mockReturnValueOnce(makeModel({ publish: true }))
      cmdExpose("qwen2-5-7b", true)
      expect(logCalls.join("\n")).toContain("exposed")

      logCalls = []
      vi.mocked(setPublished).mockReturnValueOnce(makeModel({ publish: false }))
      cmdExpose("qwen2-5-7b", false)
      expect(logCalls.join("\n")).toContain("hidden")
    })
  })

  describe("cmdRm", () => {
    it("throws error when trying to remove a running model", () => {
      vi.mocked(supervisor.list).mockReturnValueOnce([makeInstance()])
      expect(() => cmdRm("qwen2-5-7b")).toThrow("cannot remove qwen2-5-7b: currently running")
    })

    it("deletes stopped model and logs confirmation", () => {
      vi.mocked(supervisor.list).mockReturnValueOnce([])
      vi.mocked(deleteModelFromDisk).mockReturnValueOnce(makeModel())
      cmdRm("qwen2-5-7b")
      expect(logCalls.join("\n")).toContain("deleted qwen2-5-7b from disk")
    })
  })

  describe("cmdSync", () => {
    it("syncs pi and reports exposed model count", async () => {
      vi.mocked(supervisor.list).mockReturnValueOnce([])
      vi.mocked(listModels).mockReturnValueOnce([makeModel({ publish: true }), makeModel({ id: "m2", publish: false })])

      await cmdSync()
      expect(syncPiNow).toHaveBeenCalled()
      expect(logCalls.join("\n")).toContain("pi sync: 1 model exposed")
    })
  })

  describe("cmdShow", () => {
    it("throws when model is unknown", () => {
      vi.mocked(getModel).mockReturnValueOnce(undefined)
      expect(() => cmdShow("nonexistent")).toThrow("unknown model: nonexistent")
    })

    it("displays model details, caps, recommendation, and tune hints for MLX", () => {
      vi.mocked(getModel).mockReturnValueOnce(makeModel({
        capabilities: ["vlm"],
        reasoningEffort: {
          templateDefault: "medium",
          athanorDefault: "medium",
          enum: ["low", "medium", "high"]
        }
      }))
      vi.mocked(supervisor.list).mockReturnValueOnce([makeInstance()])

      cmdShow("qwen2-5-7b")
      const output = logCalls.join("\n")
      expect(output).toContain("qwen2-5-7b")
      expect(output).toContain("mlx")
      expect(output).toContain("8081")
      expect(output).toContain("vision-capable")
      expect(output).toContain("reasoning-capable")
      expect(output).toContain("recommendation")
      expect(output).toContain("effective config")
    })

    it("displays model details and hints for llama.cpp with MTP", () => {
      vi.mocked(getModel).mockReturnValueOnce(makeModel({
        runtime: "llama.cpp",
        capabilities: ["mtp"],
        reasoningEffort: {
          templateDefault: "default",
          athanorDefault: "default",
          enum: ["default", "high"]
        }
      }))
      vi.mocked(supervisor.list).mockReturnValueOnce([])

      cmdShow("qwen2-5-7b")
      const output = logCalls.join("\n")
      expect(output).toContain("llama.cpp")
      expect(output).toContain("MTP-capable")
      expect(output).toContain("idle")
    })

    it("displays active formula notice when formula is present", () => {
      vi.mocked(getModel).mockReturnValueOnce(makeModel({
        formula: {
          runtime: "mlx",
          mlx: { maxTokens: 8192 }
        }
      }))
      vi.mocked(supervisor.list).mockReturnValueOnce([])

      cmdShow("qwen2-5-7b")
      const output = logCalls.join("\n")
      expect(output).toContain("formula active")
    })
  })

  describe("cmdFlavor", () => {
    it("warns when flipping to vlm without detected vision tower and suggests restart if running", () => {
      vi.mocked(getModel).mockReturnValueOnce(makeModel({
        runtime: "mlx",
        mlxFlavor: "lm",
        mlxCapabilities: []
      }))
      vi.mocked(setFlavor).mockReturnValueOnce(makeModel({
        runtime: "mlx",
        mlxFlavor: "vlm"
      }))
      vi.mocked(supervisor.list).mockReturnValue([makeInstance()])

      cmdFlavor("qwen2-5-7b", "vlm")
      const output = logCalls.join("\n")
      expect(output).toContain("has no detected vision tower")
      expect(output).toContain("flavor →")
      expect(output).toContain("restart to apply")
    })

    it("informs when flavor is already set to requested value", () => {
      vi.mocked(getModel).mockReturnValueOnce(makeModel({
        runtime: "mlx",
        mlxFlavor: "lm"
      }))

      cmdFlavor("qwen2-5-7b", "lm")
      const output = logCalls.join("\n")
      expect(output).toContain("already lm")
    })
  })
})
