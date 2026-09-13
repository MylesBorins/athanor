import { describe, it, expect, beforeEach, vi } from "vitest"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import type { ModelEntry } from "../types/index.js"

function entry(): ModelEntry {
  return {
    id: "mlx-community/A",
    slug: "a",
    path: "/cache/a",
    runtime: "mlx",
    source: { type: "hf", repo: "mlx-community/A" },
    port: 8081,
    publish: true,
    piAlias: "a",
    addedAt: 0
  }
}

const PI_DIR = process.env.PI_HOME!
const PI_MODELS = path.join(PI_DIR, "agent", "models.json")
const PI_SETTINGS = path.join(PI_DIR, "agent", "settings.json")

function resetPiFiles(): void {
  try { fs.unlinkSync(PI_MODELS) } catch { /* not present */ }
  try { fs.unlinkSync(PI_SETTINGS) } catch { /* not present */ }
}

describe("app model service", () => {
  beforeEach(() => {
    vi.resetModules()
    resetPiFiles()
    vi.doMock("../router/lifecycle.js", () => ({
      ensureIngress: vi.fn(),
      reconcileIngressForCurrentState: vi.fn(),
      stopIngressIfIdle: vi.fn(async () => {})
    }))
    vi.doMock("../router/server.js", () => ({
      stopRouter: vi.fn(async () => {})
    }))
  })

  it("startModel starts via supervisor and syncs pi with active default", async () => {
    const start = vi.fn(async () => ({
      id: "mlx-community/A", slug: "a", runtime: "mlx" as const, port: 8081,
      pid: 123, startedAt: 0, status: "running" as const, logFile: "/tmp/a.log"
    }))
    const list = vi.fn(() => [
      { id: "mlx-community/A", slug: "a", runtime: "mlx" as const, port: 8081,
        pid: 123, startedAt: 0, status: "running" as const, logFile: "/tmp/a.log" }
    ])
    const syncPi = vi.fn()

    vi.doMock("../registry/index.js", () => ({
      getModel: () => entry(),
      removeModel: vi.fn(),
      setModelFlavor: vi.fn(),
      setModelPreset: vi.fn(),
      setModelPublish: vi.fn()
    }))
    vi.doMock("../supervisor/index.js", () => ({ supervisor: { start, stop: vi.fn(), stopAll: vi.fn(), restart: vi.fn(), list } }))
    vi.doMock("../sync/pi.js", () => ({ syncPi }))
    vi.doMock("../discovery/ingest.js", () => ({ ingestDiscovered: vi.fn() }))
    vi.doMock("../pull/hf.js", () => ({ pull: vi.fn() }))

    const mod = await import("./models.js")
    const res = await mod.startModel("a", { confirm: true })
    expect(res.entry.slug).toBe("a")
    expect(res.instance?.pid).toBe(123)
    expect(syncPi).toHaveBeenCalledWith({
      activeDefault: expect.objectContaining({ id: "mlx-community/A" }),
      instances: [expect.objectContaining({ id: "mlx-community/A" })]
    })
  })

  it("deleteModelFromDisk removes a local model file and syncs pi", async () => {
    const tmp = fs.mkdtempSync(path.join(process.env.ATHANOR_HOME!, "delete-local-"))
    const file = path.join(tmp, "a.gguf")
    fs.writeFileSync(file, "x")
    const syncPi = vi.fn()
    const removeModel = vi.fn(() => true)

    vi.doMock("../registry/index.js", () => ({
      getModel: () => ({ ...entry(), runtime: "llama.cpp" as const, path: file, source: { type: "local" as const } }),
      removeModel,
      setModelFlavor: vi.fn(),
      setModelPreset: vi.fn(),
      setModelPublish: vi.fn()
    }))
    vi.doMock("../supervisor/index.js", () => ({ supervisor: { start: vi.fn(), stop: vi.fn(), stopAll: vi.fn(), restart: vi.fn(), list: () => [] } }))
    vi.doMock("../sync/pi.js", () => ({ syncPi }))
    vi.doMock("../discovery/ingest.js", () => ({ ingestDiscovered: vi.fn() }))
    vi.doMock("../pull/hf.js", () => ({ pull: vi.fn() }))

    const mod = await import("./models.js")
    const deleted = mod.deleteModelFromDisk("a")
    expect(deleted.path).toBe(file)
    expect(fs.existsSync(file)).toBe(false)
    expect(removeModel).toHaveBeenCalledWith("mlx-community/A")
    expect(syncPi).toHaveBeenCalledWith({ instances: [] })
  })

  it("deleteModelFromDisk throws when model is actively running", async () => {
    vi.doMock("../registry/index.js", () => ({
      getModel: () => entry(),
      removeModel: vi.fn(),
      setModelFlavor: vi.fn(),
      setModelPreset: vi.fn(),
      setModelPublish: vi.fn()
    }))
    vi.doMock("../supervisor/index.js", () => ({
      supervisor: {
        start: vi.fn(),
        stop: vi.fn(),
        stopAll: vi.fn(),
        restart: vi.fn(),
        list: () => [{ id: "mlx-community/A", slug: "a", runtime: "mlx" as const, port: 8081, pid: 123, startedAt: 0, status: "running" as const, logFile: "/tmp/a.log" }]
      }
    }))
    vi.doMock("../sync/pi.js", () => ({ syncPi: vi.fn() }))
    vi.doMock("../discovery/ingest.js", () => ({ ingestDiscovered: vi.fn() }))
    vi.doMock("../pull/hf.js", () => ({ pull: vi.fn() }))

    const mod = await import("./models.js")
    expect(() => mod.deleteModelFromDisk("a")).toThrow("cannot delete model \"a\" while it is running")
  })

  it("deleteModelFromDisk removes the entire HF model cache repo directory for MLX models", async () => {
    const hubDir = path.join(os.homedir(), ".cache", "huggingface", "hub")
    const modelRepoDir = path.join(hubDir, "models--mlx-community--A")
    const snapshotDir = path.join(modelRepoDir, "snapshots", "123456")
    const blobsDir = path.join(modelRepoDir, "blobs")
    fs.mkdirSync(snapshotDir, { recursive: true })
    fs.mkdirSync(blobsDir, { recursive: true })
    fs.writeFileSync(path.join(blobsDir, "blob1"), "weights-content")
    fs.writeFileSync(path.join(snapshotDir, "config.json"), "{}")

    const syncPi = vi.fn()
    const removeModel = vi.fn(() => true)

    vi.doMock("../registry/index.js", () => ({
      getModel: () => ({ ...entry(), path: snapshotDir }),
      removeModel,
      setModelFlavor: vi.fn(),
      setModelPreset: vi.fn(),
      setModelPublish: vi.fn()
    }))
    vi.doMock("../supervisor/index.js", () => ({
      supervisor: { start: vi.fn(), stop: vi.fn(), stopAll: vi.fn(), restart: vi.fn(), list: () => [] }
    }))
    vi.doMock("../sync/pi.js", () => ({ syncPi }))
    vi.doMock("../discovery/ingest.js", () => ({ ingestDiscovered: vi.fn() }))
    vi.doMock("../pull/hf.js", () => ({ pull: vi.fn() }))
    vi.doUnmock("../config/index.js")

    const mod = await import("./models.js")
    const deleted = mod.deleteModelFromDisk("a")
    expect(deleted.id).toBe("mlx-community/A")
    expect(fs.existsSync(modelRepoDir)).toBe(false)
    expect(removeModel).toHaveBeenCalledWith("mlx-community/A")
    expect(syncPi).toHaveBeenCalledWith({ instances: [] })
  })

  it("setPublished updates registry and syncs pi", async () => {
    const syncPi = vi.fn()
    const setModelPublish = vi.fn(() => ({ ...entry(), publish: false }))
    const list = vi.fn(() => [])

    vi.doMock("../registry/index.js", () => ({
      getModel: vi.fn(),
      removeModel: vi.fn(),
      setModelFlavor: vi.fn(),
      setModelPreset: vi.fn(),
      setModelPublish
    }))
    vi.doMock("../supervisor/index.js", () => ({ supervisor: { start: vi.fn(), stop: vi.fn(), stopAll: vi.fn(), restart: vi.fn(), list } }))
    vi.doMock("../sync/pi.js", () => ({ syncPi }))
    vi.doMock("../discovery/ingest.js", () => ({ ingestDiscovered: vi.fn() }))
    vi.doMock("../pull/hf.js", () => ({ pull: vi.fn() }))

    const mod = await import("./models.js")
    const updated = mod.setPublished("a", false)
    expect(updated.publish).toBe(false)
    expect(setModelPublish).toHaveBeenCalledWith("a", false)
    expect(syncPi).toHaveBeenCalledWith({ instances: [] })
  })

  it("stopModel --all clears pi defaults but preserves exposed providers", async () => {
    vi.doMock("../registry/index.js", () => ({
      getModel: () => entry(),
      listModels: () => [entry()],
      removeModel: vi.fn(),
      setModelFlavor: vi.fn(),
      setModelPreset: vi.fn(),
      setModelPublish: vi.fn()
    }))
    vi.doMock("../supervisor/index.js", () => ({
      supervisor: {
        start: vi.fn(),
        stop: vi.fn(),
        stopAll: vi.fn(async () => {}),
        restart: vi.fn(),
        list: () => []
      }
    }))
    vi.doMock("../discovery/ingest.js", () => ({ ingestDiscovered: vi.fn() }))
    vi.doMock("../pull/hf.js", () => ({ pull: vi.fn() }))
    vi.doUnmock("../sync/pi.js")

    const mod = await import("./models.js")
    await mod.stopModel("--all")

    const written = JSON.parse(fs.readFileSync(PI_MODELS, "utf8"))
    expect(Object.keys(written.providers)).toEqual(["athanor-mlx"])
    expect(fs.existsSync(PI_SETTINGS)).toBe(false)
  })

  it("setPublished false removes the provider from pi output", async () => {
    let published = true
    vi.doMock("../registry/index.js", () => ({
      getModel: () => entry(),
      listModels: () => published ? [entry()] : [{ ...entry(), publish: false }],
      removeModel: vi.fn(),
      setModelFlavor: vi.fn(),
      setModelPreset: vi.fn(),
      setModelPublish: vi.fn((_id: string, value: boolean) => {
        published = value
        return { ...entry(), publish: value }
      })
    }))
    vi.doMock("../supervisor/index.js", () => ({
      supervisor: {
        start: vi.fn(),
        stop: vi.fn(),
        stopAll: vi.fn(),
        restart: vi.fn(),
        list: () => []
      }
    }))
    vi.doMock("../discovery/ingest.js", () => ({ ingestDiscovered: vi.fn() }))
    vi.doMock("../pull/hf.js", () => ({ pull: vi.fn() }))
    vi.doUnmock("../sync/pi.js")

    const mod = await import("./models.js")
    mod.setPublished("a", false)

    const written = JSON.parse(fs.readFileSync(PI_MODELS, "utf8"))
    expect(written.providers).toEqual({})
  })

  it("startModel writes active default provider/model to pi settings", async () => {
    vi.doMock("../registry/index.js", () => ({
      getModel: () => entry(),
      listModels: () => [entry()],
      removeModel: vi.fn(),
      setModelFlavor: vi.fn(),
      setModelPreset: vi.fn(),
      setModelPublish: vi.fn()
    }))
    vi.doMock("../supervisor/index.js", () => ({
      supervisor: {
        start: vi.fn(async () => ({
          id: "mlx-community/A", slug: "a", runtime: "mlx" as const, port: 8081,
          pid: 123, startedAt: 0, status: "running" as const, logFile: "/tmp/a.log"
        })),
        stop: vi.fn(),
        stopAll: vi.fn(),
        restart: vi.fn(),
        list: () => [{
          id: "mlx-community/A", slug: "a", runtime: "mlx" as const, port: 8081,
          pid: 123, startedAt: 0, status: "running" as const, logFile: "/tmp/a.log"
        }]
      }
    }))
    vi.doMock("../discovery/ingest.js", () => ({ ingestDiscovered: vi.fn() }))
    vi.doMock("../pull/hf.js", () => ({ pull: vi.fn() }))
    vi.doUnmock("../sync/pi.js")

    const mod = await import("./models.js")
    await mod.startModel("a", { confirm: true })

    const settings = JSON.parse(fs.readFileSync(PI_SETTINGS, "utf8"))
    expect(settings.defaultProvider).toBe("athanor-mlx")
    expect(settings.defaultModel).toBe("mlx-community/A")
  })

  it("setPreset stores balanced as an explicit preset", async () => {
    let current = entry()
    const setModelFormulaMock = vi.fn((_id: string, formula: ModelEntry["formula"]) => {
      current = { ...current, formula, preset: formula }
      return current
    })
    vi.doMock("../registry/index.js", () => ({
      getModel: () => current,
      removeModel: vi.fn(),
      setModelFlavor: vi.fn(),
      setModelPublish: vi.fn(),
      setModelFormula: setModelFormulaMock,
      setModelPreset: setModelFormulaMock
    }))
    vi.doMock("../supervisor/index.js", () => ({
      supervisor: { start: vi.fn(), stop: vi.fn(), stopAll: vi.fn(), restart: vi.fn(), list: () => [] }
    }))
    vi.doMock("../sync/pi.js", () => ({ syncPi: vi.fn() }))
    vi.doMock("../discovery/ingest.js", () => ({ ingestDiscovered: vi.fn() }))
    vi.doMock("../pull/hf.js", () => ({ pull: vi.fn() }))

    const { setPreset } = await import("./models.js")
    const { findRecipe, recipeToPreset } = await import("../presets/recipes.js")
    const preset = recipeToPreset(findRecipe("balanced")!, "mlx")
    const updated = setPreset("a", preset)

    expect(updated.preset).toEqual({
      runtime: "mlx",
      mlx: {
        prefillStepSize: 2048,
        promptCacheSize: 65536,
        decodeConcurrency: 1,
        contextWindow: 65536,
        maxTokens: 4096,
        promptCacheBytes: 16 * 1024 ** 3
      }
    })
  })

  it("setPreset clear removes an existing preset", async () => {
    let current: ModelEntry = {
      ...entry(),
      preset: { runtime: "mlx", mlx: { promptCacheSize: 32768 } }
    }
    const setModelFormulaMock = vi.fn((_id: string, formula: ModelEntry["formula"]) => {
      current = { ...current, formula, preset: formula }
      return current
    })
    vi.doMock("../registry/index.js", () => ({
      getModel: () => current,
      removeModel: vi.fn(),
      setModelFlavor: vi.fn(),
      setModelPublish: vi.fn(),
      setModelFormula: setModelFormulaMock,
      setModelPreset: setModelFormulaMock
    }))
    vi.doMock("../supervisor/index.js", () => ({
      supervisor: { start: vi.fn(), stop: vi.fn(), stopAll: vi.fn(), restart: vi.fn(), list: () => [] }
    }))
    vi.doMock("../sync/pi.js", () => ({ syncPi: vi.fn() }))
    vi.doMock("../discovery/ingest.js", () => ({ ingestDiscovered: vi.fn() }))
    vi.doMock("../pull/hf.js", () => ({ pull: vi.fn() }))

    const { setPreset } = await import("./models.js")
    const updated = setPreset("a", undefined)
    expect(updated.preset).toBeUndefined()
  })

  it("setPreset replaces prior recipe fields instead of leaving stale ones", async () => {
    let current: ModelEntry = {
      ...entry(),
      preset: { runtime: "mlx", mlx: { prefillStepSize: 256, promptCacheSize: 8192, decodeConcurrency: 1 } }
    }
    const setModelFormulaMock = vi.fn((_id: string, formula: ModelEntry["formula"]) => {
      current = { ...current, formula, preset: formula }
      return current
    })
    vi.doMock("../registry/index.js", () => ({
      getModel: () => current,
      removeModel: vi.fn(),
      setModelFlavor: vi.fn(),
      setModelPublish: vi.fn(),
      setModelFormula: setModelFormulaMock,
      setModelPreset: setModelFormulaMock
    }))
    vi.doMock("../supervisor/index.js", () => ({
      supervisor: { start: vi.fn(), stop: vi.fn(), stopAll: vi.fn(), restart: vi.fn(), list: () => [] }
    }))
    vi.doMock("../sync/pi.js", () => ({ syncPi: vi.fn() }))
    vi.doMock("../discovery/ingest.js", () => ({ ingestDiscovered: vi.fn() }))
    vi.doMock("../pull/hf.js", () => ({ pull: vi.fn() }))

    const { setPreset } = await import("./models.js")
    const { findRecipe, recipeToPreset } = await import("../presets/recipes.js")
    const balanced = recipeToPreset(findRecipe("balanced")!, "mlx")
    const updated = setPreset("a", balanced)

    expect(updated.preset).toEqual({
      runtime: "mlx",
      mlx: {
        prefillStepSize: 2048,
        promptCacheSize: 65536,
        decodeConcurrency: 1,
        contextWindow: 65536,
        maxTokens: 4096,
        promptCacheBytes: 16 * 1024 ** 3
      }
    })
  })

  it("removeModelEntry removes model and triggers syncPi", async () => {
    const removeModel = vi.fn(() => true)
    const syncPi = vi.fn()
    vi.doMock("../registry/index.js", () => ({
      getModel: () => entry(),
      removeModel
    }))
    vi.doMock("../supervisor/index.js", () => ({
      supervisor: { list: () => [] }
    }))
    vi.doMock("../sync/pi.js", () => ({ syncPi }))

    const { removeModelEntry } = await import("./models.js")
    removeModelEntry("a")

    expect(removeModel).toHaveBeenCalledWith("a")
    expect(syncPi).toHaveBeenCalledWith({ instances: [] })
  })

  it("removeModelEntry throws when model is not found in registry", async () => {
    vi.doMock("../registry/index.js", () => ({
      getModel: () => undefined,
      removeModel: () => false
    }))
    vi.doMock("../supervisor/index.js", () => ({
      supervisor: { list: () => [] }
    }))
    vi.doMock("../sync/pi.js", () => ({ syncPi: vi.fn() }))

    const { removeModelEntry } = await import("./models.js")
    expect(() => removeModelEntry("nonexistent")).toThrow("unknown model: nonexistent")
  })

  it("syncPiNow reconciles ingress and syncs pi with activeDefault", async () => {
    const syncPi = vi.fn()
    const reconcileIngressForCurrentState = vi.fn(async () => {})
    vi.doMock("../router/lifecycle.js", () => ({
      reconcileIngressForCurrentState,
      ensureIngress: vi.fn(),
      stopIngressIfIdle: vi.fn()
    }))
    vi.doMock("../supervisor/index.js", () => ({
      supervisor: { list: () => [] }
    }))
    vi.doMock("../sync/pi.js", () => ({ syncPi }))

    const { syncPiNow } = await import("./models.js")
    const activeDefault = {
      id: "mlx-community/A", slug: "a", runtime: "mlx" as const, port: 8081,
      pid: 123, startedAt: 0, status: "running" as const, logFile: "/tmp/a.log"
    }
    await syncPiNow(activeDefault)

    expect(reconcileIngressForCurrentState).toHaveBeenCalled()
    expect(syncPi).toHaveBeenCalledWith({ activeDefault, instances: [] })
  })

  it("deleteModelFromDisk throws when model is currently running", async () => {
    vi.doMock("../registry/index.js", () => ({
      getModel: () => entry(),
      removeModel: vi.fn()
    }))
    vi.doMock("../supervisor/index.js", () => ({
      supervisor: {
        list: () => [{
          id: "mlx-community/A", slug: "a", runtime: "mlx" as const, port: 8081,
          pid: 123, startedAt: 0, status: "running" as const, logFile: "/tmp/a.log"
        }]
      }
    }))
    vi.doMock("../sync/pi.js", () => ({ syncPi: vi.fn() }))

    const { deleteModelFromDisk } = await import("./models.js")
    expect(() => deleteModelFromDisk("a")).toThrow("cannot delete model \"a\" while it is running")
  })

  it("deleteModelFromDisk throws when files cannot be removed", async () => {
    vi.doMock("../registry/index.js", () => ({
      getModel: () => ({ ...entry(), path: "/nonexistent/path/for/model" }),
      removeModel: vi.fn()
    }))
    vi.doMock("../supervisor/index.js", () => ({
      supervisor: { list: () => [] }
    }))
    vi.doMock("../sync/pi.js", () => ({ syncPi: vi.fn() }))

    const { deleteModelFromDisk } = await import("./models.js")
    expect(() => deleteModelFromDisk("a")).toThrow("could not remove files from disk for a")
  })

  it("stopModel stops all instances when passed --all or undefined", async () => {
    const stopAll = vi.fn(async () => true)
    const syncPi = vi.fn()
    const stopIngressIfIdle = vi.fn(async () => {})
    vi.doMock("../supervisor/index.js", () => ({
      supervisor: { stopAll, stop: vi.fn(), list: () => [] }
    }))
    vi.doMock("../sync/pi.js", () => ({ syncPi }))
    vi.doMock("../router/lifecycle.js", () => ({ stopIngressIfIdle, ensureIngress: vi.fn() }))

    const { stopModel } = await import("./models.js")
    const res = await stopModel("--all")
    expect(res.stoppedAll).toBe(true)
    expect(res.stopped).toBe(true)
    expect(stopAll).toHaveBeenCalled()
    expect(stopIngressIfIdle).toHaveBeenCalled()
    expect(syncPi).toHaveBeenCalledWith({ instances: [] })
  })

  it("stopModel stops a specific model and syncs pi", async () => {
    const stop = vi.fn(async () => true)
    const syncPi = vi.fn()
    vi.doMock("../registry/index.js", () => ({
      getModel: () => entry()
    }))
    vi.doMock("../supervisor/index.js", () => ({
      supervisor: { stop, stopAll: vi.fn(), list: () => [] }
    }))
    vi.doMock("../sync/pi.js", () => ({ syncPi }))

    const { stopModel } = await import("./models.js")
    const res = await stopModel("a")
    expect(res.stoppedAll).toBe(false)
    expect(res.stopped).toBe(true)
    expect(stop).toHaveBeenCalledWith("mlx-community/A", undefined)
    expect(syncPi).toHaveBeenCalledWith({ instances: [] })
  })

  it("stopModel throws when model is unknown", async () => {
    vi.doMock("../registry/index.js", () => ({
      getModel: () => undefined
    }))
    const { stopModel } = await import("./models.js")
    await expect(stopModel("unknown")).rejects.toThrow("unknown model: unknown")
  })

  it("restartModel throws when model is unknown", async () => {
    vi.doMock("../registry/index.js", () => ({
      getModel: () => undefined
    }))
    const { restartModel } = await import("./models.js")
    await expect(restartModel("unknown")).rejects.toThrow("unknown model: unknown")
  })

  it("restartModel restarts via supervisor and syncs pi when confirmed", async () => {
    const restart = vi.fn(async () => ({
      id: "mlx-community/A", slug: "a", runtime: "mlx" as const, port: 8081,
      pid: 456, startedAt: 0, status: "running" as const, logFile: "/tmp/a.log"
    }))
    const syncPi = vi.fn()
    vi.doMock("../registry/index.js", () => ({
      getModel: () => entry()
    }))
    vi.doMock("../supervisor/index.js", () => ({
      supervisor: { restart, list: () => [] }
    }))
    vi.doMock("../sync/pi.js", () => ({ syncPi }))

    const { restartModel } = await import("./models.js")
    const res = await restartModel("a", { confirm: true })
    expect(res.entry.slug).toBe("a")
    expect(res.instance?.pid).toBe(456)
    expect(syncPi).toHaveBeenCalled()
  })

  it("restartModel discounts running instance memory in preflight", async () => {
    const restart = vi.fn(async () => ({
      id: "mlx-community/A", slug: "a", runtime: "mlx" as const, port: 8081,
      pid: 456, startedAt: 0, status: "running" as const, logFile: "/tmp/a.log"
    }))
    const syncPi = vi.fn()
    const buildStartPreflightMock = vi.fn(() => ({
      currentUsedGiB: 5, projectedUsedGiB: 8, machineTotalGiB: 16, estimatedFootprintGiB: 3,
      shouldWarn: false, shouldStrongWarn: false
    }))
    vi.doMock("./preflight.js", () => ({ buildStartPreflight: buildStartPreflightMock }))
    vi.doMock("../registry/index.js", () => ({
      getModel: () => entry()
    }))
    vi.doMock("../supervisor/index.js", () => ({
      supervisor: {
        ready: vi.fn(),
        restart,
        list: () => [{ id: "mlx-community/A", pid: 456, status: "running" }]
      }
    }))
    vi.doMock("../supervisor/metrics.js", () => ({
      sampleProcessStats: () => new Map([[456, { pid: 456, cpuPct: 0, rssBytes: 4 * 1024 ** 3 }]])
    }))
    vi.doMock("../sync/pi.js", () => ({ syncPi }))

    const { restartModel } = await import("./models.js")
    const res = await restartModel("a")
    expect(res.entry.slug).toBe("a")
    expect(buildStartPreflightMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { discountBytes: 4 * 1024 ** 3 }
    )
    expect(restart).toHaveBeenCalled()
  })

  it("deleteModelFromDisk refuses to remove MLX snapshot outside HF cache", async () => {
    const tmp = fs.mkdtempSync(path.join(process.env.ATHANOR_HOME!, "outside-hf-"))
    const outsideFile = path.join(tmp, "weights.safetensors")
    fs.writeFileSync(outsideFile, "data")

    vi.doMock("../registry/index.js", () => ({
      getModel: () => ({ ...entry(), path: outsideFile, runtime: "mlx" as const }),
      removeModel: vi.fn()
    }))
    vi.doMock("../supervisor/index.js", () => ({
      supervisor: { list: () => [] }
    }))

    const { deleteModelFromDisk } = await import("./models.js")
    expect(() => deleteModelFromDisk("a")).toThrow("refusing to remove snapshot outside HF cache")
  })

  it("deleteModelFromDisk removes single-file GGUF and cleans empty snapshot directory", async () => {
    const tmp = fs.mkdtempSync(path.join(process.env.ATHANOR_HOME!, "hf-gguf-"))
    const snapshotDir = path.join(tmp, "snapshots", "rev1")
    fs.mkdirSync(snapshotDir, { recursive: true })
    const ggufFile = path.join(snapshotDir, "model.gguf")
    fs.writeFileSync(ggufFile, "gguf-data")

    const removeModel = vi.fn(() => true)
    vi.doMock("../registry/index.js", () => ({
      getModel: () => ({
        ...entry(),
        runtime: "llama.cpp" as const,
        path: ggufFile,
        source: { type: "hf" as const, repo: "org/repo", file: "model.gguf" }
      }),
      removeModel
    }))
    vi.doMock("../supervisor/index.js", () => ({
      supervisor: { list: () => [] }
    }))

    const { deleteModelFromDisk } = await import("./models.js")
    const deleted = deleteModelFromDisk("a")
    expect(deleted.path).toBe(ggufFile)
    expect(fs.existsSync(ggufFile)).toBe(false)
    expect(fs.existsSync(snapshotDir)).toBe(false)
    expect(removeModel).toHaveBeenCalledWith("mlx-community/A")
  })
})
