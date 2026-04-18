import * as fs from "fs"
import { describe, it, expect, beforeEach } from "vitest"
import { ingestDiscovered } from "./ingest.js"
import { listModels, updateModel } from "../registry/index.js"
import { PATHS } from "../config/index.js"
import type { DiscoveredModel } from "../types/index.js"

function reset(): void {
  try { fs.unlinkSync(PATHS.registry) } catch { /* not present */ }
}

function mlxDiscovered(overrides: Partial<DiscoveredModel> = {}): DiscoveredModel {
  return {
    id: "mlx-community/Test-4bit",
    name: "Test-4bit",
    path: "/cache/mlx/snap1",
    runtime: "mlx",
    source: { type: "hf", repo: "mlx-community/Test-4bit" },
    sizeBytes: 1_000_000,
    ...overrides
  }
}

function ggufDiscovered(overrides: Partial<DiscoveredModel> = {}): DiscoveredModel {
  return {
    id: "local/path/model.gguf",
    name: "model",
    path: "/models/model.gguf",
    runtime: "llama.cpp",
    source: { type: "local" },
    sizeBytes: 2_000_000,
    ...overrides
  }
}

describe("ingestDiscovered", () => {
  beforeEach(reset)

  it("inserts new entries and allocates ports in order", () => {
    const rep = ingestDiscovered([
      mlxDiscovered({ id: "a", name: "a" }),
      ggufDiscovered({ id: "b", name: "b" })
    ])
    expect(rep.added).toHaveLength(2)
    expect(rep.unchanged).toBe(0)
    const models = listModels()
    expect(models.map(m => m.slug).sort()).toEqual(["a", "b"])
    expect(models.map(m => m.port).sort()).toEqual([8081, 8082])
  })

  it("second run reports all unchanged", () => {
    const discovered = [mlxDiscovered(), ggufDiscovered()]
    ingestDiscovered(discovered)
    const rep = ingestDiscovered(discovered)
    expect(rep.added).toHaveLength(0)
    expect(rep.unchanged).toBe(2)
  })

  it("preserves user-edited fields on re-ingest", () => {
    ingestDiscovered([mlxDiscovered()])
    const first = listModels()[0]!
    updateModel(first.id, {
      publish: false,
      piAlias: "custom-alias",
      preset: { runtime: "mlx", mlx: { decodeConcurrency: 8 } },
      tags: ["coder"]
    })
    ingestDiscovered([mlxDiscovered()])
    const after = listModels()[0]!
    expect(after.publish).toBe(false)
    expect(after.piAlias).toBe("custom-alias")
    expect(after.preset).toEqual({ runtime: "mlx", mlx: { decodeConcurrency: 8 } })
    expect(after.tags).toEqual(["coder"])
    expect(after.port).toBe(first.port)
  })

  it("updates the path when the snapshot hash changes", () => {
    ingestDiscovered([mlxDiscovered({ path: "/cache/mlx/snap-old" })])
    const rep = ingestDiscovered([mlxDiscovered({ path: "/cache/mlx/snap-new" })])
    expect(rep.updatedPath).toHaveLength(1)
    expect(rep.unchanged).toBe(0)
    expect(listModels()[0]!.path).toBe("/cache/mlx/snap-new")
  })

  it("produces unique slugs when discovered names collide", () => {
    const rep = ingestDiscovered([
      mlxDiscovered({ id: "a", name: "dup" }),
      mlxDiscovered({ id: "b", name: "dup" })
    ])
    expect(rep.added).toHaveLength(2)
    const slugs = listModels().map(m => m.slug).sort()
    expect(slugs).toEqual(["dup", "dup-2"])
  })

  it("defaults new entries to publish=true with piAlias=slug", () => {
    ingestDiscovered([mlxDiscovered({ id: "x", name: "x" })])
    const m = listModels()[0]!
    expect(m.publish).toBe(true)
    expect(m.piAlias).toBe(m.slug)
  })

  it("carries mlxFlavor from discovery into new entries", () => {
    ingestDiscovered([mlxDiscovered({ id: "vl", name: "vl", mlxFlavor: "vlm" })])
    expect(listModels()[0]!.mlxFlavor).toBe("vlm")
  })

  it("refreshes mlxFlavor on re-ingest when upstream config changes", () => {
    ingestDiscovered([mlxDiscovered({ mlxFlavor: "lm" })])
    const rep = ingestDiscovered([mlxDiscovered({ mlxFlavor: "vlm" })])
    expect(rep.updatedPath).toHaveLength(1)
    expect(listModels()[0]!.mlxFlavor).toBe("vlm")
  })
})
