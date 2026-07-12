import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import { PATHS } from "../config/index.js"
import {
  deduplicateByPath,
  detectArchitectureFamily,
  detectMlxCapabilities,
  detectMlxMetadata,
  detectGgufMetadata,
  detectGgufMtp,
  parseOrgRepoDir,
  scanModels
} from "./scanner.js"
import type { DiscoveredModel } from "../types/index.js"

describe("discovery scanner metadata helpers", () => {
  let tmp: string

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "athanor-scanner-"))
  })

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  it("detects architecture family from model type and fallback name", () => {
    expect(detectArchitectureFamily("qwen2", "ignored")).toBe("qwen")
    expect(detectArchitectureFamily(undefined, "Llama-3.2-3B-Instruct")).toBe("llama")
    expect(detectArchitectureFamily(undefined, "mystery-model")).toBeUndefined()
  })

  it("detects MLX VLM capability from vision_config", () => {
    fs.writeFileSync(path.join(tmp, "config.json"), JSON.stringify({ vision_config: {} }))
    expect(detectMlxCapabilities(tmp)).toEqual(["vlm"])
  })

  it("extracts MLX metadata from config and quantization config", () => {
    fs.writeFileSync(path.join(tmp, "config.json"), JSON.stringify({
      model_type: "qwen2",
      max_position_embeddings: 32768,
      num_experts: 8,
      num_experts_per_tok: 2
    }))
    fs.writeFileSync(path.join(tmp, "quantization_config.json"), JSON.stringify({ bits: 4, group_size: 64 }))

    expect(detectMlxMetadata(tmp, "Qwen-model")).toEqual({
      architectureFamily: "qwen",
      trainedContextLength: 32768,
      quantization: "4-bit",
      isMoe: true,
      activeParams: 2,
      metadataSource: "mlx_config"
    })
  })

  it("falls back to file-size-only metadata for unreadable MLX config", () => {
    expect(detectMlxMetadata(tmp, "unknown")).toEqual({ metadataSource: "file_size_only" })
  })

  it("infers GGUF metadata from filename", () => {
    const meta = detectGgufMetadata("/models/Qwen3-4B-Instruct-Q4_K_M.gguf", "Qwen3-4B-Instruct-Q4_K_M")
    expect(meta.architectureFamily).toBe("qwen")
    expect(meta.quantization).toBe("Q4_K_M")
    expect(meta.metadataSource).toBe("gguf_header")
  })

  it("does not classify generic safetensors snapshots as MLX without an MLX marker", () => {
    const snapshotDir = path.join(tmp, "models--author--plain-transformers", "snapshots", "abc123")
    fs.mkdirSync(snapshotDir, { recursive: true })
    fs.writeFileSync(path.join(snapshotDir, "config.json"), JSON.stringify({ model_type: "llama" }))
    fs.writeFileSync(path.join(snapshotDir, "model.safetensors"), "weights")

    const prevConfig = fs.existsSync(PATHS.config)
      ? fs.readFileSync(PATHS.config, "utf8")
      : null
    fs.writeFileSync(PATHS.config, JSON.stringify({
      modelDirs: { mlx: tmp, llama: path.join(tmp, "llama-empty") }
    }))

    try {
      const models = scanModels().filter(m => m.path === snapshotDir)
      expect(models).toEqual([])
    } finally {
      if (prevConfig === null) {
        try { fs.unlinkSync(PATHS.config) } catch { /* absent */ }
      } else {
        fs.writeFileSync(PATHS.config, prevConfig)
      }
    }
  })

  it("uses file-size-only metadata when GGUF quantization is unknown", () => {
    const meta = detectGgufMetadata("/models/custom-model.gguf", "custom-model")
    expect(meta.architectureFamily).toBeUndefined()
    expect(meta.quantization).toBeUndefined()
    expect(meta.metadataSource).toBe("file_size_only")
  })

  it("detects GGUF MTP capabilities from binary keywords", () => {
    const mtpFile = path.join(tmp, "mtp.gguf")
    const normalFile = path.join(tmp, "normal.gguf")

    // Mock an MTP file containing nextn_predict_layers
    const mtpBuffer = Buffer.alloc(100)
    mtpBuffer.write("nextn_predict_layers")
    fs.writeFileSync(mtpFile, mtpBuffer)

    // Mock a normal file
    const normalBuffer = Buffer.alloc(100)
    normalBuffer.write("nothing special")
    fs.writeFileSync(normalFile, normalBuffer)

    expect(detectGgufMtp(mtpFile)).toBe(true)
    expect(detectGgufMtp(normalFile)).toBe(false)
  })

  it("parseOrgRepoDir reads athanor pull directory names", () => {
    expect(parseOrgRepoDir("unsloth--Qwen3.6-27B-GGUF")).toEqual({
      org: "unsloth",
      repo: "Qwen3.6-27B-GGUF"
    })
    expect(parseOrgRepoDir("flat-name")).toBeNull()
  })

  it("scanGgufModels keeps ordinary org--repo folders as local GGUF paths", () => {
    const repoDir = path.join(tmp, "unsloth--Qwen3.6-27B-GGUF")
    fs.mkdirSync(repoDir, { recursive: true })
    const ggufPath = path.join(repoDir, "Qwen3.6-27B-Q4_K_M.gguf")
    fs.writeFileSync(ggufPath, "gguf")

    const prevConfig = fs.existsSync(PATHS.config)
      ? fs.readFileSync(PATHS.config, "utf8")
      : null
    fs.writeFileSync(PATHS.config, JSON.stringify({
      modelDirs: { mlx: path.join(tmp, "mlx-empty"), llama: tmp }
    }))

    try {
      const models = scanModels().filter(m => m.path === ggufPath)
      expect(models).toHaveLength(1)
      expect(models[0]!.source).toEqual({ type: "local" })
      expect(models[0]!.id).toBe(ggufPath)
    } finally {
      if (prevConfig === null) {
        try { fs.unlinkSync(PATHS.config) } catch { /* absent */ }
      } else {
        fs.writeFileSync(PATHS.config, prevConfig)
      }
    }
  })

  it("deduplicateByPath keeps the hf-sourced entry when paths collide", () => {
    const modelPath = path.join(tmp, "shared.gguf")
    fs.writeFileSync(modelPath, "gguf")
    const local: DiscoveredModel = {
      id: modelPath,
      name: "shared",
      path: modelPath,
      runtime: "llama.cpp",
      source: { type: "local" },
      sizeBytes: 100
    }
    const hf: DiscoveredModel = {
      id: "author/repo:shared.gguf",
      name: "shared",
      path: modelPath,
      runtime: "llama.cpp",
      source: { type: "hf", repo: "author/repo", file: "shared.gguf" },
      sizeBytes: 100
    }
    const deduped = deduplicateByPath([local, hf])
    expect(deduped).toHaveLength(1)
    expect(deduped[0]!.source.type).toBe("hf")
    expect(deduped[0]!.id).toBe("author/repo:shared.gguf")
  })
})
