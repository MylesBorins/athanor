import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import {
  detectArchitectureFamily,
  detectMlxCapabilities,
  detectMlxMetadata,
  detectGgufMetadata
} from "./scanner.js"

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

  it("uses file-size-only metadata when GGUF quantization is unknown", () => {
    const meta = detectGgufMetadata("/models/custom-model.gguf", "custom-model")
    expect(meta.architectureFamily).toBeUndefined()
    expect(meta.quantization).toBeUndefined()
    expect(meta.metadataSource).toBe("file_size_only")
  })
})
