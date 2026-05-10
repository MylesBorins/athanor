import * as fs from "fs"
import { beforeEach, describe, expect, it } from "vitest"
import { PATHS } from "../config/index.js"
import { listModels, updateModel } from "./index.js"
import {
  discoveredToMaterializeInput,
  materializeRegistryEntry,
  pullToMaterializeInput
} from "./materialize.js"
import type { DiscoveredModel } from "../types/index.js"

function reset(): void {
  try { fs.unlinkSync(PATHS.registry) } catch { /* not present */ }
}

function discovered(overrides: Partial<DiscoveredModel> = {}): DiscoveredModel {
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

describe("registry materialization", () => {
  beforeEach(reset)

  it("creates new entries with stable default fields", () => {
    const result = materializeRegistryEntry(discoveredToMaterializeInput(discovered({ id: "a", name: "a" })))
    expect(result.created).toBe(true)
    expect(result.changed).toBe(true)
    expect(result.entry.slug).toBe("a")
    expect(result.entry.port).toBe(8081)
    expect(result.entry.publish).toBe(true)
    expect(result.entry.piAlias).toBe("a")
  })

  it("updates path, size, and mlx capabilities for existing entries without touching user fields", () => {
    materializeRegistryEntry(discoveredToMaterializeInput(discovered()))
    updateModel("mlx-community/Test-4bit", {
      publish: false,
      piAlias: "custom-alias",
      tags: ["coder"],
      preset: { runtime: "mlx", mlx: { decodeConcurrency: 8 } },
      mlxFlavor: "lm"
    })

    const result = materializeRegistryEntry(discoveredToMaterializeInput(discovered({
      path: "/cache/mlx/snap2",
      sizeBytes: 2_000_000,
      mlxCapabilities: ["vlm"]
    })))

    expect(result.created).toBe(false)
    expect(result.changed).toBe(true)
    const entry = listModels()[0]!
    expect(entry.path).toBe("/cache/mlx/snap2")
    expect(entry.sizeBytes).toBe(2_000_000)
    expect(entry.mlxCapabilities).toEqual(["vlm"])
    expect(entry.publish).toBe(false)
    expect(entry.piAlias).toBe("custom-alias")
    expect(entry.tags).toEqual(["coder"])
    expect(entry.preset).toEqual({ runtime: "mlx", mlx: { decodeConcurrency: 8 } })
    expect(entry.mlxFlavor).toBe("lm")
  })

  it("removes mlx capabilities when refreshed detection no longer finds any", () => {
    materializeRegistryEntry(discoveredToMaterializeInput(discovered({ mlxCapabilities: ["vlm"] })))
    const result = materializeRegistryEntry(discoveredToMaterializeInput(discovered({ mlxCapabilities: [] })))
    expect(result.created).toBe(false)
    expect(result.changed).toBe(true)
    expect(listModels()[0]!.mlxCapabilities).toBeUndefined()
  })

  it("preserves slug and port on pull-style updates", () => {
    const first = materializeRegistryEntry(
      pullToMaterializeInput("author/repo", "model.gguf", "main", "llama.cpp", "/models/one/model.gguf")
    ).entry
    const updated = materializeRegistryEntry(
      pullToMaterializeInput("author/repo", "model.gguf", "main", "llama.cpp", "/models/two/model.gguf")
    ).entry
    expect(updated.slug).toBe(first.slug)
    expect(updated.port).toBe(first.port)
    expect(updated.path).toBe("/models/two/model.gguf")
  })

  it("includes the HF repo tail in default llama pull slugs", () => {
    const result = materializeRegistryEntry(
      pullToMaterializeInput("unsloth/Qwen3.5-27B-GGUF", "Qwen3.5-27B-Q4_K_M.gguf", "main", "llama.cpp", "/models/q.gguf")
    )
    expect(result.entry.slug).toBe("qwen3-5-27b-gguf-qwen3-5-27b-q4-k-m")
  })

  it("returns unchanged=false only when no materialized fields changed", () => {
    materializeRegistryEntry(discoveredToMaterializeInput(discovered()))
    const result = materializeRegistryEntry(discoveredToMaterializeInput(discovered()))
    expect(result.created).toBe(false)
    expect(result.changed).toBe(false)
  })
})
