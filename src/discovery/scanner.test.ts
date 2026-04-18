import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { describe, it, expect } from "vitest"
import {
  scanModels,
  getModelByPath,
  getRuntimeForModel,
  detectMlxCapabilities
} from "./scanner.js"
import type { DiscoveredModel } from "../types/index.js"

type Model = DiscoveredModel

function mkSnapshot(cfg: Record<string, unknown> | null): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "athanor-snap-"))
  if (cfg !== null) {
    fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify(cfg), "utf8")
  }
  return dir
}

describe("Scanner", () => {
  describe("scanModels", () => {
    it("should return empty array when no models found", () => {
      const models = scanModels()
      // This will be empty in test environment without actual models
      expect(Array.isArray(models)).toBe(true)
    })

    it("should handle non-existent directories gracefully", () => {
      // This test verifies the scanner doesn't crash on missing dirs
      expect(() => scanModels()).not.toThrow()
    })
  })

  describe("getModelByPath", () => {
    it("should return undefined for non-existent path", () => {
      const found = getModelByPath("/non/existent/path")
      expect(found).toBeUndefined()
    })

    it("should find model when it exists", () => {
      const models = scanModels()
      if (models.length > 0) {
        const found = getModelByPath(models[0]!.path)
        expect(found).toBeDefined()
        expect(found?.path).toBe(models[0]!.path)
      }
    })
  })

  describe("detectMlxCapabilities", () => {
    it("returns [\"vlm\"] when config.json has a vision_config block", () => {
      const dir = mkSnapshot({
        model_type: "qwen2_5_vl",
        vision_config: { hidden_size: 1280 }
      })
      expect(detectMlxCapabilities(dir)).toEqual(["vlm"])
    })

    it("returns [\"vlm\"] for known VLM model_types without vision_config", () => {
      const dir = mkSnapshot({ model_type: "llava_next" })
      expect(detectMlxCapabilities(dir)).toEqual(["vlm"])
    })

    it("returns [\"vlm\"] when architectures include a VL marker", () => {
      const dir = mkSnapshot({
        model_type: "qwen2",
        architectures: ["Qwen2VLForConditionalGeneration"]
      })
      expect(detectMlxCapabilities(dir)).toEqual(["vlm"])
    })

    it("returns [] for plain text-only LLMs", () => {
      const dir = mkSnapshot({
        model_type: "qwen3",
        architectures: ["Qwen3ForCausalLM"]
      })
      expect(detectMlxCapabilities(dir)).toEqual([])
    })

    it("returns [] for text-only MoE models (e.g. Qwen3-A3B)", () => {
      // MoE doesn't imply multimodal; the A3B family is text-only.
      const dir = mkSnapshot({
        model_type: "qwen3_moe",
        architectures: ["Qwen3MoeForCausalLM"],
        num_experts: 128,
        num_experts_per_tok: 8
      })
      expect(detectMlxCapabilities(dir)).toEqual([])
    })

    it("returns [] for text-only variants of families with a VLM sibling", () => {
      // Gemma 3 1B/4B text-only has model_type "gemma3" but no
      // vision_config; only 12B/27B multimodal variants do.
      const dir = mkSnapshot({
        model_type: "gemma3",
        architectures: ["Gemma3ForCausalLM"]
      })
      expect(detectMlxCapabilities(dir)).toEqual([])
    })

    it("detects multimodal Gemma 3 via vision_config", () => {
      const dir = mkSnapshot({
        model_type: "gemma3",
        vision_config: { hidden_size: 1152 },
        architectures: ["Gemma3ForConditionalGeneration"]
      })
      expect(detectMlxCapabilities(dir)).toEqual(["vlm"])
    })

    it("returns [] when config.json is missing or malformed", () => {
      expect(detectMlxCapabilities(mkSnapshot(null))).toEqual([])
      const bad = fs.mkdtempSync(path.join(os.tmpdir(), "athanor-snap-"))
      fs.writeFileSync(path.join(bad, "config.json"), "{{{not json", "utf8")
      expect(detectMlxCapabilities(bad)).toEqual([])
    })
  })

  describe("scanModels + HF cache layout", () => {
    // Build a fixture that mimics the real HF hub cache layout for a
    // sharded MoE checkpoint (Qwen3-style A3B). Exercises:
    //   - models--<org>--<repo> parsing with dashes in the repo name
    //   - refs/main → snapshots/<hash> resolution
    //   - multi-shard safetensors + sibling index files
    //   - capability detection end-to-end through scanMlxModels
    function buildHfCache(tmpHub: string): void {
      const repoDir = path.join(tmpHub, "models--mlx-community--Qwen3-A3B-Test-4bit")
      const hash = "abc123def456"
      const snap = path.join(repoDir, "snapshots", hash)
      fs.mkdirSync(path.join(repoDir, "refs"), { recursive: true })
      fs.mkdirSync(snap, { recursive: true })
      fs.writeFileSync(path.join(repoDir, "refs", "main"), hash, "utf8")
      fs.writeFileSync(path.join(snap, "config.json"), JSON.stringify({
        model_type: "qwen3_moe",
        architectures: ["Qwen3MoeForCausalLM"],
        num_experts: 128
      }))
      // Multiple shards, an index file, and a tokenizer — the real
      // mixture of siblings an MoE snapshot carries.
      for (let i = 1; i <= 3; i++) {
        const name = `model-0000${i}-of-00003.safetensors`
        fs.writeFileSync(path.join(snap, name), Buffer.alloc(1024, i))
      }
      fs.writeFileSync(path.join(snap, "model.safetensors.index.json"), "{}")
      fs.writeFileSync(path.join(snap, "tokenizer.json"), "{}")
    }

    it("discovers sharded MoE snapshots with empty mlxCapabilities", async () => {
      const hub = fs.mkdtempSync(path.join(os.tmpdir(), "athanor-hub-"))
      buildHfCache(hub)

      // Point athanor's model dirs at the fixture hub. loadConfig()
      // merges over defaults, so only modelDirs needs to be set.
      const { PATHS: p } = await import("../config/index.js")
      fs.writeFileSync(p.config, JSON.stringify({
        modelDirs: { mlx: hub, llama: path.join(hub, "__none__") }
      }))

      const models = scanModels()
      const found = models.find(m =>
        m.source.type === "hf" &&
        m.source.repo === "mlx-community/Qwen3-A3B-Test-4bit"
      )
      expect(found).toBeDefined()
      expect(found!.runtime).toBe("mlx")
      expect(found!.mlxCapabilities).toEqual([])
      // 3 shards × 1024 bytes, plus small index + tokenizer.
      expect(found!.sizeBytes).toBeGreaterThanOrEqual(3 * 1024)

      // Clean the stub config so other tests see defaults again.
      try { fs.unlinkSync(p.config) } catch { /* ignore */ }
    })
  })

  describe("getRuntimeForModel", () => {
    it("should return runtime from model", () => {
      const mlxModel: Model = {
        id: "test",
        name: "test",
        path: "/test/model",
        runtime: "mlx",
        source: { type: "hf", repo: "mlx-community/Test" }
      }
      expect(getRuntimeForModel(mlxModel)).toBe("mlx")

      const llamaModel: Model = {
        id: "test",
        name: "test",
        path: "/test/model",
        runtime: "llama.cpp",
        source: { type: "local" }
      }
      expect(getRuntimeForModel(llamaModel)).toBe("llama.cpp")
    })
  })
})
