import { describe, it, expect, beforeEach, vi } from "vitest"
import * as fs from "fs"
import * as path from "path"
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
    vi.doMock("../registry/index.js", () => ({
      getModel: () => current,
      removeModel: vi.fn(),
      setModelFlavor: vi.fn(),
      setModelPublish: vi.fn(),
      setModelPreset: vi.fn((_id: string, preset: ModelEntry["preset"]) => {
        current = { ...current, preset }
        return current
      })
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
      mlx: { prefillStepSize: 512, promptCacheSize: 32768, decodeConcurrency: 1 }
    })
  })

  it("setPreset clear removes an existing preset", async () => {
    let current: ModelEntry = {
      ...entry(),
      preset: { runtime: "mlx", mlx: { promptCacheSize: 32768 } }
    }
    vi.doMock("../registry/index.js", () => ({
      getModel: () => current,
      removeModel: vi.fn(),
      setModelFlavor: vi.fn(),
      setModelPublish: vi.fn(),
      setModelPreset: vi.fn((_id: string, preset: ModelEntry["preset"]) => {
        current = { ...current, preset }
        return current
      })
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
    vi.doMock("../registry/index.js", () => ({
      getModel: () => current,
      removeModel: vi.fn(),
      setModelFlavor: vi.fn(),
      setModelPublish: vi.fn(),
      setModelPreset: vi.fn((_id: string, preset: ModelEntry["preset"]) => {
        current = { ...current, preset }
        return current
      })
    }))
    vi.doMock("../supervisor/index.js", () => ({
      supervisor: { start: vi.fn(), stop: vi.fn(), stopAll: vi.fn(), restart: vi.fn(), list: () => [] }
    }))
    vi.doMock("../sync/pi.js", () => ({ syncPi: vi.fn() }))
    vi.doMock("../discovery/ingest.js", () => ({ ingestDiscovered: vi.fn() }))
    vi.doMock("../pull/hf.js", () => ({ pull: vi.fn() }))

    const { setPreset } = await import("./models.js")
    const { findRecipe, recipeToPreset } = await import("../presets/recipes.js")
    const quality = recipeToPreset(findRecipe("quality")!, "mlx")
    const updated = setPreset("a", quality)

    expect(updated.preset).toEqual({
      runtime: "mlx",
      mlx: { prefillStepSize: 512, promptCacheSize: 32768, decodeConcurrency: 1 }
    })
  })
})
