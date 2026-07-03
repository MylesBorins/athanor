import * as fs from "fs"
import { describe, it, expect, beforeEach } from "vitest"
import {
  getModel,
  listModels,
  loadRegistry,
  removeModel,
  saveRegistry,
  setModelFlavor,
  setModelPreset,
  setModelPublish,
  snapshot,
  touchModelLastUsed,
  updateModel,
  upsertModel
} from "./index.js"
import { PATHS } from "../config/index.js"
import type { ModelEntry } from "../types/index.js"

function entry(overrides: Partial<ModelEntry> = {}): ModelEntry {
  return {
    id: "x/y",
    slug: "y",
    path: "/m/y",
    runtime: "mlx",
    source: { type: "hf", repo: "x/y" },
    port: 8081,
    publish: true,
    piAlias: "y",
    addedAt: 1,
    ...overrides
  }
}

function resetRegistry(): void {
  try { fs.unlinkSync(PATHS.registry) } catch { /* not present */ }
}

describe("registry CRUD", () => {
  beforeEach(resetRegistry)

  describe("loadRegistry / saveRegistry", () => {
    it("returns empty registry when file is absent", () => {
      expect(loadRegistry()).toEqual({ version: 1, models: [] })
    })

    it("round-trips a registry through the filesystem", () => {
      saveRegistry({ version: 1, models: [entry()] })
      const reg = loadRegistry()
      expect(reg.models).toHaveLength(1)
      expect(reg.models[0]!.slug).toBe("y")
    })

    it("throws when the file is malformed", () => {
      fs.writeFileSync(PATHS.registry, "not json")
      expect(() => loadRegistry()).toThrow("Failed to load registry")
      expect(fs.readFileSync(PATHS.registry, "utf8")).toBe("not json")
    })

    it("throws when models is not an array", () => {
      fs.writeFileSync(PATHS.registry, JSON.stringify({ models: "oops" }))
      expect(() => loadRegistry()).toThrow("expected models to be an array")
    })
  })

  describe("upsertModel", () => {
    it("inserts when id is new", () => {
      upsertModel(entry({ id: "a", slug: "a" }))
      expect(listModels().map(m => m.slug)).toEqual(["a"])
    })

    it("updates in place when id exists", () => {
      upsertModel(entry({ id: "a", slug: "a", port: 8081 }))
      upsertModel(entry({ id: "a", slug: "a", port: 8090 }))
      const all = listModels()
      expect(all).toHaveLength(1)
      expect(all[0]!.port).toBe(8090)
    })
  })

  describe("updateModel", () => {
    it("applies a partial patch by id", () => {
      upsertModel(entry({ id: "a", slug: "a" }))
      const next = updateModel("a", { publish: false, tags: ["x"] })
      expect(next?.publish).toBe(false)
      expect(next?.tags).toEqual(["x"])
    })

    it("returns undefined when the model is unknown", () => {
      expect(updateModel("missing", { publish: false })).toBeUndefined()
    })

    it("also matches on slug", () => {
      upsertModel(entry({ id: "long/id", slug: "short" }))
      const next = updateModel("short", { publish: false })
      expect(next?.id).toBe("long/id")
    })
  })

  describe("semantic mutation helpers", () => {
    it("sets publish via a dedicated helper", () => {
      upsertModel(entry({ id: "a", slug: "a" }))
      const next = setModelPublish("a", false)
      expect(next?.publish).toBe(false)
    })

    it("sets flavor via a dedicated helper", () => {
      upsertModel(entry({ id: "a", slug: "a" }))
      const next = setModelFlavor("a", "vlm")
      expect(next?.mlxFlavor).toBe("vlm")
    })

    it("sets preset via a dedicated helper", () => {
      upsertModel(entry({ id: "a", slug: "a" }))
      const next = setModelPreset("a", { runtime: "mlx", mlx: { decodeConcurrency: 4 } })
      expect(next?.preset).toEqual({ runtime: "mlx", mlx: { decodeConcurrency: 4 } })
    })

    it("touches lastUsedAt via a dedicated helper", () => {
      upsertModel(entry({ id: "a", slug: "a" }))
      const next = touchModelLastUsed("a", 123)
      expect(next?.lastUsedAt).toBe(123)
    })
  })

  describe("removeModel / getModel", () => {
    it("removes by id or slug and returns false when absent", () => {
      upsertModel(entry({ id: "a", slug: "a-slug" }))
      expect(removeModel("a-slug")).toBe(true)
      expect(listModels()).toHaveLength(0)
      expect(removeModel("a-slug")).toBe(false)
    })

    it("getModel matches id or slug", () => {
      upsertModel(entry({ id: "x/y", slug: "y-short" }))
      expect(getModel("x/y")?.slug).toBe("y-short")
      expect(getModel("y-short")?.id).toBe("x/y")
      expect(getModel("nope")).toBeUndefined()
    })
  })

  describe("snapshot", () => {
    it("exposes sets of ids, slugs, ports, paths", () => {
      upsertModel(entry({ id: "a", slug: "a", port: 8081, path: "/m/a" }))
      upsertModel(entry({ id: "b", slug: "b", port: 8082, path: "/m/b" }))
      const snap = snapshot()
      expect(snap.ids).toEqual(new Set(["a", "b"]))
      expect(snap.slugs).toEqual(new Set(["a", "b"]))
      expect(snap.ports).toEqual(new Set([8081, 8082]))
      expect(snap.paths).toEqual(new Set(["/m/a", "/m/b"]))
    })
  })
})
