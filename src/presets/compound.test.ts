import { describe, it, expect } from "vitest"
import {
  COMPOUND_KNOBS,
  getCategoriesForRuntime,
  inferCompoundState,
  applyCompoundSelection
} from "./compound.js"
import type { ModelEntry } from "../types/index.js"

function llamaEntry(overrides: Partial<ModelEntry> = {}): ModelEntry {
  return {
    id: "unsloth/Qwen3.8-27B-GGUF:Qwen3.8-27B-Q4_K_M.gguf",
    slug: "qwen3-8-27b-q4-k-m",
    path: "/models/qwen3-8.gguf",
    runtime: "llama.cpp",
    source: { type: "local" },
    port: 8082,
    publish: true,
    addedAt: 0,
    ...overrides
  }
}

function mlxEntry(overrides: Partial<ModelEntry> = {}): ModelEntry {
  return {
    id: "mlx-community/Qwen2.5-32B-Instruct-4bit",
    slug: "qwen-32b",
    path: "/models/qwen-32b",
    runtime: "mlx",
    source: { type: "hf", repo: "mlx-community/Qwen2.5-32B-Instruct-4bit" },
    port: 8081,
    publish: true,
    addedAt: 0,
    ...overrides
  }
}

describe("compound presets", () => {
  it("defines standard compound knobs for both runtimes", () => {
    const ids = COMPOUND_KNOBS.map(k => k.id)
    expect(ids).toContain("contextWindow")
    expect(ids).toContain("kvCache")
    expect(ids).toContain("speculative")
    expect(ids).toContain("samplingMode")
    expect(ids).toContain("gpuOffload")
  })

  it("returns grouped domain categories for llama and mlx", () => {
    const llamaCats = getCategoriesForRuntime("llama.cpp")
    expect(llamaCats.map(c => c.name)).toEqual([
      "HARDWARE & CONTEXT",
      "MEMORY & KV CACHE",
      "SAMPLING & PENALTIES",
      "SPECULATIVE DECODING"
    ])

    const mlxCats = getCategoriesForRuntime("mlx")
    expect(mlxCats.map(c => c.name)).toEqual([
      "HARDWARE & CONTEXT",
      "MEMORY & KV CACHE",
      "SAMPLING & PENALTIES",
      "SPECULATIVE DECODING"
    ])
  })

  describe("inferCompoundState", () => {
    it("infers thinking mode correctly with float tolerance", () => {
      const entry = llamaEntry()
      const effective = {
        ctxSize: 65536,
        temp: 1.0,
        topP: 0.95,
        topK: 20,
        minP: 0.0,
        presencePenalty: 0.0,
        repeatPenalty: 1.0,
        nGpuLayers: 999,
        cacheTypeK: "q8_0",
        cacheTypeV: "q8_0",
        speculativeMode: "enabled"
      }
      const state = inferCompoundState(entry, effective)
      expect(state.contextWindow).toBe("65536")
      expect(state.kvCache).toBe("q8_0")
      expect(state.speculative).toBe("mtp")
      expect(state.samplingMode).toBe("thinking")
      expect(state.gpuOffload).toBe("all")
    })

    it("infers instruct mode and f16 KV cache", () => {
      const entry = llamaEntry()
      const effective = {
        ctxSize: 32768,
        temp: 0.7,
        topP: 0.80,
        topK: 20,
        minP: 0.0,
        presencePenalty: 1.5,
        repeatPenalty: 1.0,
        nGpuLayers: 0
      }
      const state = inferCompoundState(entry, effective)
      expect(state.contextWindow).toBe("32768")
      expect(state.kvCache).toBe("f16")
      expect(state.samplingMode).toBe("instruct")
      expect(state.gpuOffload).toBe("cpu")
    })

    it("infers custom when sampling or context diverges", () => {
      const entry = llamaEntry()
      const effective = {
        ctxSize: 50000,
        temp: 0.42,
        topP: 0.80,
        topK: 20,
        cacheTypeK: "q8_0",
        cacheTypeV: "q4_0" // asymmetric -> custom
      }
      const state = inferCompoundState(entry, effective)
      expect(state.contextWindow).toBe("custom")
      expect(state.kvCache).toBe("custom")
      expect(state.samplingMode).toBe("custom")
    })
  })

  describe("applyCompoundSelection", () => {
    it("applies q8_0 KV cache selection atomically with flashAttn", () => {
      const entry = llamaEntry()
      const preset = applyCompoundSelection(entry, "kvCache", "q8_0")
      expect(preset?.runtime).toBe("llama.cpp")
      if (preset?.runtime !== "llama.cpp") throw new Error()
      expect(preset.llama.cacheTypeK).toBe("q8_0")
      expect(preset.llama.cacheTypeV).toBe("q8_0")
      expect(preset.llama.flashAttn).toBe("on")
    })

    it("unsets cacheTypeK and cacheTypeV when reverting to f16", () => {
      const entry = llamaEntry({
        preset: {
          runtime: "llama.cpp",
          llama: { cacheTypeK: "q8_0", cacheTypeV: "q8_0", flashAttn: "on", ctxSize: 65536 }
        }
      })
      const preset = applyCompoundSelection(entry, "kvCache", "f16")
      if (preset?.runtime !== "llama.cpp") throw new Error()
      expect(preset.llama.cacheTypeK).toBeUndefined()
      expect(preset.llama.cacheTypeV).toBeUndefined()
      expect(preset.llama.flashAttn).toBe("on") // Flash attention preserved!
      expect(preset.llama.ctxSize).toBe(65536)
    })

    it("applies mtp speculative decoding selection", () => {
      const entry = llamaEntry()
      const preset = applyCompoundSelection(entry, "speculative", "mtp")
      if (preset?.runtime !== "llama.cpp") throw new Error()
      expect(preset.llama.speculativeMode).toBe("enabled")
      expect(preset.llama.specType).toBe("draft-mtp")
      expect(preset.llama.specDraftNgl).toBe(999)
    })

    it("applies thinking sampling mode for MLX without llama penalty keys", () => {
      const entry = mlxEntry()
      const preset = applyCompoundSelection(entry, "samplingMode", "thinking")
      expect(preset?.runtime).toBe("mlx")
      if (preset?.runtime !== "mlx") throw new Error()
      expect(preset.mlx.temp).toBe(1.0)
      expect(preset.mlx.topP).toBe(0.95)
      expect(preset.mlx.topK).toBe(20)
      expect(preset.mlx.minP).toBe(0.0)
    })

    it("applies and unsets reasoning effort selections", () => {
      const entry = llamaEntry({
        reasoningEffort: {
          enum: ["xhigh", "medium", "low"],
          templateDefault: "xhigh",
          athanorDefault: "medium"
        }
      })
      const preset = applyCompoundSelection(entry, "reasoningEffort", "medium")
      if (preset?.runtime !== "llama.cpp") throw new Error()
      expect(preset.llama.reasoningEffort).toBe("medium")

      const unset = applyCompoundSelection(entry, "reasoningEffort", "off")
      if (unset && unset.runtime === "llama.cpp") {
        expect(unset.llama.reasoningEffort).toBeUndefined()
      }
    })

    it("applies and unsets kvCache for MLX", () => {
      const entry = mlxEntry()
      const q8 = applyCompoundSelection(entry, "kvCache", "q8_0")
      expect(q8?.runtime).toBe("mlx")
      if (q8?.runtime !== "mlx") throw new Error()
      expect(q8.mlx.kvBits).toBe(8)

      // When kvBits was the only preset field, unsetting returns undefined
      const f16Empty = applyCompoundSelection({ ...entry, preset: q8 }, "kvCache", "f16")
      expect(f16Empty).toBeUndefined()

      // When other preset fields exist, unsetting removes kvBits while preserving others
      const withCtx = { runtime: "mlx" as const, mlx: { kvBits: 8, contextWindow: 65536 } }
      const f16Preserved = applyCompoundSelection({ ...entry, preset: withCtx }, "kvCache", "f16")
      expect(f16Preserved?.runtime).toBe("mlx")
      if (f16Preserved?.runtime !== "mlx") throw new Error()
      expect(f16Preserved.mlx.kvBits).toBeUndefined()
      expect(f16Preserved.mlx.contextWindow).toBe(65536)
    })

    it("infers MLX kvCache and speculative state", () => {
      const entry = mlxEntry()
      const state1 = inferCompoundState(entry, { kvBits: 8, draftModel: "mlx-community/Qwen2.5-0.5B-Instruct-4bit" })
      expect(state1.kvCache).toBe("q8_0")
      expect(state1.speculative).toBe("draft")

      const state2 = inferCompoundState(entry, { kvBits: 0 })
      expect(state2.kvCache).toBe("f16")
      expect(state2.speculative).toBe("off")
    })
  })
})
