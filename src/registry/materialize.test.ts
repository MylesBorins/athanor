import * as fs from "fs"
import { beforeEach, describe, expect, it } from "vitest"
import { PATHS } from "../config/index.js"
import { listModels, updateModel } from "./index.js"
import {
  discoveredToMaterializeInput,
  materializeRegistryEntry,
  pullToMaterializeInput,
  type RegistryMaterializeInput
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
    expect(result.entry.port).toBe(12436)
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

  it("deduplicates by path when pull and scan produce different ids for the same file", () => {
    // Simulate pull: creates entry with repo:file id
    const pullResult = materializeRegistryEntry(
      pullToMaterializeInput(
        "unsloth/Qwen3.6-27B-GGUF",
        "qwen3-6-27b-q6-k.gguf",
        undefined,
        "llama.cpp",
        "/models/unsloth--Qwen3.6-27B-GGUF/qwen3-6-27b-q6-k.gguf"
      )
    )
    expect(pullResult.created).toBe(true)
    expect(pullResult.entry.id).toBe("unsloth/Qwen3.6-27B-GGUF:qwen3-6-27b-q6-k.gguf")
    const pullSlug = pullResult.entry.slug
    const pullPort = pullResult.entry.port

    // Simulate scan: same file but with fullPath id and local source
    const scanInput = {
      id: "/models/unsloth--Qwen3.6-27B-GGUF/qwen3-6-27b-q6-k.gguf",
      name: "qwen3-6-27b-q6-k",
      path: "/models/unsloth--Qwen3.6-27B-GGUF/qwen3-6-27b-q6-k.gguf",
      runtime: "llama.cpp" as const,
      source: { type: "local" } as const,
      sizeBytes: 15_000_000_000,
      quantization: "Q6_K",
      architectureFamily: "qwen",
      metadataSource: "gguf_header" as const
    }
    const scanResult = materializeRegistryEntry(scanInput)

    // Should NOT create a duplicate
    expect(scanResult.created).toBe(false)
    expect(listModels().length).toBe(1)

    // Original slug and port preserved
    const entry = listModels()[0]!
    expect(entry.slug).toBe(pullSlug)
    expect(entry.port).toBe(pullPort)

    // HF source preserved (not downgraded to local)
    expect(entry.source.type).toBe("hf")
    expect((entry.source as { type: "hf"; repo: string }).repo).toBe("unsloth/Qwen3.6-27B-GGUF")

    // Detected metadata from scan merged in
    expect(entry.sizeBytes).toBe(15_000_000_000)
    expect(entry.quantization).toBe("Q6_K")
    expect(entry.architectureFamily).toBe("qwen")
  })

  it("upgrades local source to hf when pull follows scan", () => {
    // Simulate scan first (local source, fullPath id)
    const scanInput = {
      id: "/models/my-model.gguf",
      name: "my-model",
      path: "/models/my-model.gguf",
      runtime: "llama.cpp" as const,
      source: { type: "local" } as const,
      sizeBytes: 5_000_000,
      metadataSource: "file_size_only" as const
    }
    const scanResult = materializeRegistryEntry(scanInput)
    expect(scanResult.created).toBe(true)
    expect(scanResult.entry.source.type).toBe("local")
    const originalSlug = scanResult.entry.slug

    // Simulate pull of the same file (hf source, repo:file id)
    const pullResult = materializeRegistryEntry(
      pullToMaterializeInput(
        "author/model-gguf",
        "my-model.gguf",
        undefined,
        "llama.cpp",
        "/models/my-model.gguf"
      )
    )
    expect(pullResult.created).toBe(false)
    expect(listModels().length).toBe(1)

    const entry = listModels()[0]!
    expect(entry.slug).toBe(originalSlug)
    expect(entry.source.type).toBe("hf")
    expect((entry.source as { type: "hf"; repo: string }).repo).toBe("author/model-gguf")
    expect(entry.id).toBe("author/model-gguf:my-model.gguf")
  })

  it("persists source upgrade even when no other fields change", () => {
    // Race condition: watcher scan creates local entry with same path
    // and sizeBytes as the pull will produce. updateExistingEntry returns
    // false because nothing changed except source, so the save must be
    // driven by the upgrade itself.
    const scanInput: RegistryMaterializeInput = {
      id: "/models/same-model.gguf",
      name: "same-model",
      path: "/models/same-model.gguf",
      runtime: "llama.cpp",
      source: { type: "local" },
      sizeBytes: 5_000_000
    }
    const scanResult = materializeRegistryEntry(scanInput)
    expect(scanResult.created).toBe(true)

    // Pull of the same file with identical path and sizeBytes.
    // updateExistingEntry returns false (no fields to update),
    // but the source upgrade must still persist.
    const pullResult = materializeRegistryEntry(
      pullToMaterializeInput(
        "author/model",
        "same-model.gguf",
        undefined,
        "llama.cpp",
        "/models/same-model.gguf"
      )
    )
    // Manually patch sizeBytes to match so updateExistingEntry is no-op
    // (pullToMaterializeInput doesn't set sizeBytes; scanner does).
    // The key assertion: source must be "hf" in the persisted registry.
    expect(pullResult.created).toBe(false)
    const entry = listModels()[0]!
    expect(entry.source.type).toBe("hf")
    expect((entry.source as { type: "hf"; repo: string }).repo).toBe("author/model")
    expect(entry.id).toBe("author/model:same-model.gguf")
  })
})
