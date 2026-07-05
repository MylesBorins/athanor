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
    expect(models.map(m => m.port).sort()).toEqual([40880, 40881])
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
      mlxDiscovered({ id: "a", name: "dup", path: "/cache/mlx/dup-1" }),
      mlxDiscovered({ id: "b", name: "dup", path: "/cache/mlx/dup-2" })
    ])
    expect(rep.added).toHaveLength(2)
    const slugs = listModels().map(m => m.slug).sort()
    expect(slugs).toEqual(["dup", "dup-2"])
  })

  it("includes the HF repo tail in default discovered GGUF slugs", () => {
    ingestDiscovered([ggufDiscovered({
      id: "unsloth/Qwen3.5-27B-GGUF:Qwen3.5-27B-Q4_K_M.gguf",
      name: "Qwen3.5-27B-Q4_K_M",
      path: "/models/Qwen3.5-27B-Q4_K_M.gguf",
      source: { type: "hf", repo: "unsloth/Qwen3.5-27B-GGUF", file: "Qwen3.5-27B-Q4_K_M.gguf" }
    })])
    expect(listModels()[0]!.slug).toBe("qwen3-5-27b-gguf-qwen3-5-27b-q4-k-m")
  })

  it("defaults new entries to publish=true with piAlias=slug", () => {
    ingestDiscovered([mlxDiscovered({ id: "x", name: "x" })])
    const m = listModels()[0]!
    expect(m.publish).toBe(true)
    expect(m.piAlias).toBe(m.slug)
  })

  it("carries mlxCapabilities from discovery and leaves mlxFlavor unset", () => {
    ingestDiscovered([mlxDiscovered({ id: "vl", name: "vl", mlxCapabilities: ["vlm"] })])
    const m = listModels()[0]!
    expect(m.mlxCapabilities).toEqual(["vlm"])
    expect(m.mlxFlavor).toBeUndefined()
  })

  it("never flips user mlxFlavor on re-ingest, even when capabilities update", () => {
    // Flavor is a runtime choice, not a discovered fact: for VLMs that
    // mlx_lm can serve text-only (e.g. Qwen VL), the user may prefer
    // "lm" on purpose. Ingest must never touch mlxFlavor.
    ingestDiscovered([mlxDiscovered()])
    updateModel(listModels()[0]!.id, { mlxFlavor: "lm" })
    const rep = ingestDiscovered([mlxDiscovered({ mlxCapabilities: ["vlm"] })])
    expect(rep.updatedPath).toHaveLength(1)
    expect(listModels()[0]!.mlxFlavor).toBe("lm")
    expect(listModels()[0]!.mlxCapabilities).toEqual(["vlm"])
  })

  it("refreshes mlxCapabilities on re-ingest when detection changes", () => {
    // Capabilities are a detected fact — safe to overwrite as
    // heuristics improve or config.json changes.
    ingestDiscovered([mlxDiscovered()])
    expect(listModels()[0]!.mlxCapabilities).toBeUndefined()
    const rep = ingestDiscovered([mlxDiscovered({ mlxCapabilities: ["vlm"] })])
    expect(rep.updatedPath).toHaveLength(1)
    expect(listModels()[0]!.mlxCapabilities).toEqual(["vlm"])
  })
})
