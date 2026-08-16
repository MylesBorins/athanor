import { describe, it, expect, beforeEach } from "vitest"
import { LlamaAdapter } from "./llama.js"
import type { LlamaConfig } from "../types/index.js"
import { llamaEntry } from "./__fixtures.js"

const llama: LlamaConfig = {
  nGpuLayers: 999,
  ctxSize: 12288,
  batchSize: 128,
  ubatchSize: 64,
  parallel: 1
}

describe("LlamaAdapter", () => {
  let adapter: LlamaAdapter
  beforeEach(() => { adapter = new LlamaAdapter() })

  it("builds the llama-server command with all flags and --alias", () => {
    const entry = llamaEntry({
      path: "/models/model.gguf",
      port: 8091,
      piAlias: "test-gguf"
    })
    const { cmd, args } = adapter.buildCommand(entry, llama)
    expect(cmd).toBe("llama-server")
    expect(args).toEqual([
      "-m", "/models/model.gguf",
      "--alias", "test-gguf",
      "--port", "8091",
      "--host", "127.0.0.1",
      "--n-gpu-layers", "999",
      "--ctx-size", "12288",
      "--batch-size", "128",
      "--ubatch-size", "64",
      "--parallel", "1"
    ])
  })

  it("falls back to slug when piAlias is not set", () => {
    const entry = llamaEntry({ piAlias: undefined, slug: "raw" })
    const { args } = adapter.buildCommand(entry, llama)
    const i = args.indexOf("--alias")
    expect(args[i + 1]).toBe("raw")
  })

  it("uses registry id as alias for hf gguf with default piAlias", () => {
    const entry = llamaEntry({
      id: "unsloth/Qwen3.6-27B-GGUF:Qwen3.6-27B-Q4_K_M.gguf",
      slug: "qwen3-6-27b-q4-k-m",
      piAlias: "qwen3-6-27b-q4-k-m",
      source: { type: "hf", repo: "unsloth/Qwen3.6-27B-GGUF", file: "Qwen3.6-27B-Q4_K_M.gguf" }
    })
    const { args } = adapter.buildCommand(entry, llama)
    const i = args.indexOf("--alias")
    expect(args[i + 1]).toBe("unsloth/Qwen3.6-27B-GGUF:Qwen3.6-27B-Q4_K_M.gguf")
  })

  it("builds the llama-server command with speculative decoding / MTP draft flags when set", () => {
    const entry = llamaEntry({
      path: "/models/model.gguf",
      port: 8091,
      piAlias: "test-gguf"
    })
    const specLlama: LlamaConfig = {
      ...llama,
      specType: "draft-mtp",
      specDraftNMax: 4,
      specDraftNMin: 1,
      specDraftPSplit: 0.15,
      specDraftPMin: 0.8,
      specDraftModel: "/models/draft.gguf",
      specDraftNgl: 16
    }
    const { cmd, args } = adapter.buildCommand(entry, specLlama)
    expect(cmd).toBe("llama-server")
    expect(args).toEqual([
      "-m", "/models/model.gguf",
      "--alias", "test-gguf",
      "--port", "8091",
      "--host", "127.0.0.1",
      "--n-gpu-layers", "999",
      "--ctx-size", "12288",
      "--batch-size", "128",
      "--ubatch-size", "64",
      "--parallel", "1",
      "--spec-type", "draft-mtp",
      "--spec-draft-n-max", "4",
      "--spec-draft-n-min", "1",
      "--spec-draft-p-split", "0.15",
      "--spec-draft-p-min", "0.8",
      "--spec-draft-model", "/models/draft.gguf",
      "--spec-draft-ngl", "16"
    ])
  })

  it("automatically generates MTP flags when speculativeMode is auto and model is MTP-capable", () => {
    const entry = llamaEntry({
      path: "/models/model.gguf",
      capabilities: ["mtp"]
    })
    const { args } = adapter.buildCommand(entry, { ...llama, speculativeMode: "auto" })
    expect(args).toContain("--spec-type")
    expect(args[args.indexOf("--spec-type") + 1]).toBe("draft-mtp")
    expect(args).toContain("--spec-draft-ngl")
    expect(args[args.indexOf("--spec-draft-ngl") + 1]).toBe("999")
  })

  it("automatically generates MTP flags when speculativeMode is enabled", () => {
    const entry = llamaEntry({
      path: "/models/model.gguf",
      capabilities: []
    })
    const { args } = adapter.buildCommand(entry, { ...llama, speculativeMode: "enabled" })
    expect(args).toContain("--spec-type")
    expect(args[args.indexOf("--spec-type") + 1]).toBe("draft-mtp")
    expect(args).toContain("--spec-draft-ngl")
    expect(args[args.indexOf("--spec-draft-ngl") + 1]).toBe("999")
  })

  it("does not generate MTP flags when speculativeMode is disabled", () => {
    const entry = llamaEntry({
      path: "/models/model.gguf",
      capabilities: ["mtp"]
    })
    const { args } = adapter.buildCommand(entry, { ...llama, speculativeMode: "disabled" })
    expect(args).not.toContain("--spec-type")
    expect(args).not.toContain("--spec-draft-ngl")
  })

  it("includes sampling flags when present in merged config", () => {
    const entry = llamaEntry({ path: "/models/model.gguf", port: 8091 })
    const samplingLlama: LlamaConfig = {
      ...llama,
      temp: 0.7,
      topP: 0.9,
      topK: 50,
      minP: 0.05,
      repeatPenalty: 1.1,
      presencePenalty: 0.2,
      frequencyPenalty: 0.3,
      repeatLastN: 128
    }
    const { args } = adapter.buildCommand(entry, samplingLlama)
    expect(args).toContain("--temp")
    expect(args[args.indexOf("--temp") + 1]).toBe("0.7")
    expect(args).toContain("--top-p")
    expect(args[args.indexOf("--top-p") + 1]).toBe("0.9")
    expect(args).toContain("--top-k")
    expect(args[args.indexOf("--top-k") + 1]).toBe("50")
    expect(args).toContain("--min-p")
    expect(args[args.indexOf("--min-p") + 1]).toBe("0.05")
    expect(args).toContain("--repeat-penalty")
    expect(args[args.indexOf("--repeat-penalty") + 1]).toBe("1.1")
    expect(args).toContain("--presence-penalty")
    expect(args[args.indexOf("--presence-penalty") + 1]).toBe("0.2")
    expect(args).toContain("--frequency-penalty")
    expect(args[args.indexOf("--frequency-penalty") + 1]).toBe("0.3")
    expect(args).toContain("--repeat-last-n")
    expect(args[args.indexOf("--repeat-last-n") + 1]).toBe("128")
  })

  it("includes KV cache quantization and flash attention flags when present", () => {
    const entry = llamaEntry({ path: "/models/model.gguf", port: 8091 })
    const kvLlama: LlamaConfig = {
      ...llama,
      cacheTypeK: "q8_0",
      cacheTypeV: "q8_0",
      flashAttn: "on",
      specDraftCacheTypeK: "q4_0",
      specDraftCacheTypeV: "q4_0"
    }
    const { args } = adapter.buildCommand(entry, kvLlama)
    expect(args).toContain("--cache-type-k")
    expect(args[args.indexOf("--cache-type-k") + 1]).toBe("q8_0")
    expect(args).toContain("--cache-type-v")
    expect(args[args.indexOf("--cache-type-v") + 1]).toBe("q8_0")
    expect(args).toContain("--flash-attn")
    expect(args[args.indexOf("--flash-attn") + 1]).toBe("on")
    expect(args).toContain("--spec-draft-type-k")
    expect(args[args.indexOf("--spec-draft-type-k") + 1]).toBe("q4_0")
    expect(args).toContain("--spec-draft-type-v")
    expect(args[args.indexOf("--spec-draft-type-v") + 1]).toBe("q4_0")
  })

  it("returns the llama.cpp health url", () => {
    expect(adapter.healthUrl(9000)).toBe("http://127.0.0.1:9000/health")
  })
})
