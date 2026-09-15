import { describe, it, expect } from "vitest"
import {
  buildRecommendation,
  effectiveGqaRatio,
  estimateFootprintGiB,
  minOsHeadroomGiB,
  normalizeParamCount
} from "./recommend.js"
import type { ModelEntry } from "../types/index.js"
import type { MachineProfile } from "../machine/profile.js"

function modelEntry(overrides: Partial<ModelEntry> = {}): ModelEntry {
  return {
    id: "model-1",
    slug: "model-1",
    path: "/models/model.gguf",
    runtime: "llama.cpp",
    source: { type: "local" },
    port: 8081,
    publish: true,
    addedAt: 0,
    ...overrides
  }
}

function machineProfile(totalMemoryGiB: number): MachineProfile {
  return {
    totalMemoryBytes: totalMemoryGiB * 1024 ** 3,
    totalMemoryGiB,
    chip: "Apple M4"
  }
}

describe("buildRecommendation", () => {
  it("classifies small models as comfortable and caps context by machine tier", () => {
    const rec = buildRecommendation(modelEntry({
      sizeBytes: 2 * 1024 ** 3,
      trainedContextLength: 32768,
      quantization: "Q4_K_M",
      metadataSource: "gguf_header"
    }), machineProfile(16))

    expect(rec.fitBand).toBe("comfortable")
    expect(rec.estimatedFootprintGiB).toBeCloseTo(3.6093155, 5)
    expect(rec.recommendedContext).toBe(8192)
    expect(rec.recommendedContextNote).toBe("trained max: 32768")
    expect(rec.confidence).toBe("high")
    expect(rec.explanation).toContain("fits comfortably")
    expect(rec.explanation).toContain("4-bit balanced quant")
    expect(rec.presetHint).toBe("balanced")
  })

  it("classifies mid-sized models as tight and constrains context", () => {
    const rec = buildRecommendation(modelEntry({
      sizeBytes: 9 * 1024 ** 3,
      trainedContextLength: 65536,
      metadataSource: "gguf_header"
    }), machineProfile(16))

    expect(rec.fitBand).toBe("tight")
    expect(rec.recommendedContext).toBe(8192)
    expect(rec.explanation).toContain("limited headroom")
    expect(rec.explanation).toContain("constrain context")
  })

  it("classifies large models as risky and uses conservative unknown-context fallback", () => {
    const rec = buildRecommendation(modelEntry({
      sizeBytes: 12 * 1024 ** 3,
      metadataSource: "file_size_only"
    }), machineProfile(16))

    expect(rec.fitBand).toBe("risky")
    expect(rec.recommendedContext).toBe(4096)
    expect(rec.recommendedContextNote).toBe("trained context unknown; recommended based on memory capacity")
    expect(rec.confidence).toBe("low")
    expect(rec.explanation).toContain("swap risk likely")
    expect(rec.explanation).toContain("metadata unavailable — estimates from file size only")
  })

  it("includes MoE explanation details when active params are known", () => {
    const rec = buildRecommendation(modelEntry({
      sizeBytes: 18 * 1024 ** 3,
      isMoe: true,
      activeParams: 3,
      paramCount: 30,
      metadataSource: "mlx_config"
    }), machineProfile(32))

    expect(rec.confidence).toBe("high")
    expect(rec.explanation).toContain("MoE: ~3B active params per token (30B stored)")
  })

  it("falls back to medium confidence when metadata source is absent", () => {
    const rec = buildRecommendation(modelEntry({
      sizeBytes: 1 * 1024 ** 3
    }), machineProfile(8))

    expect(rec.confidence).toBe("medium")
  })

  it("suggests fast when fit is risky", () => {
    const rec = buildRecommendation(modelEntry({
      sizeBytes: 12 * 1024 ** 3,
      trainedContextLength: 32768,
      metadataSource: "gguf_header"
    }), machineProfile(8))

    expect(rec.fitBand).toBe("risky")
    expect(rec.presetHint).toBe("fast")
  })

  it("suggests long-context when context headroom is large", () => {
    const rec = buildRecommendation(modelEntry({
      sizeBytes: 4 * 1024 ** 3,
      trainedContextLength: 65536,
      metadataSource: "gguf_header"
    }), machineProfile(32))

    expect(rec.recommendedContext).toBe(32768)
    expect(rec.presetHint).toBe("long-context")
  })

  it("recommends 131072 context length for MoE models on 36 GB Macs", () => {
    const rec = buildRecommendation(modelEntry({
      sizeBytes: 18 * 1024 ** 3,
      isMoe: true,
      activeParams: 3,
      paramCount: 35,
      metadataSource: "gguf_header"
    }), machineProfile(36))

    expect(rec.fitBand).toBe("tight")
    expect(rec.recommendedContext).toBe(131072)
  })

  it("reduces estimated footprint when MLX kvBits=8 is active", () => {
    const unquantized = buildRecommendation(modelEntry({
      runtime: "mlx",
      sizeBytes: 8 * 1024 ** 3,
      trainedContextLength: 65536,
      metadataSource: "mlx_config"
    }), machineProfile(32))

    const quantized = buildRecommendation(modelEntry({
      runtime: "mlx",
      sizeBytes: 8 * 1024 ** 3,
      trainedContextLength: 65536,
      metadataSource: "mlx_config",
      formula: { runtime: "mlx", mlx: { kvBits: 8 } }
    }), machineProfile(32))

    expect(quantized.estimatedFootprintGiB).toBeLessThan(unquantized.estimatedFootprintGiB)
  })

  it("normalizes parameter counts whether passed in billions or raw units", () => {
    expect(normalizeParamCount(undefined)).toBeUndefined()
    expect(normalizeParamCount(0)).toBeUndefined()
    expect(normalizeParamCount(8)).toBe(8_000_000_000)
    expect(normalizeParamCount(70)).toBe(70_000_000_000)
    expect(normalizeParamCount(70_000_000_000)).toBe(70_000_000_000)

    const modelBillions = modelEntry({
      sizeBytes: 5 * 1024 ** 3,
      paramCount: 8,
      quantization: "Q4_K_M"
    })
    const modelRaw = modelEntry({
      sizeBytes: 5 * 1024 ** 3,
      paramCount: 8_000_000_000,
      quantization: "Q4_K_M"
    })

    const footprintBillions = estimateFootprintGiB(modelBillions, 32768)
    const footprintRaw = estimateFootprintGiB(modelRaw, 32768)
    expect(footprintBillions).toBeCloseTo(footprintRaw, 5)
  })

  it("resolves effective GQA head ratio with explicit heads and architecture heuristics", () => {
    // Explicit gqaRatio
    expect(effectiveGqaRatio(modelEntry({ gqaRatio: 0.125 }))).toBe(0.125)

    // Explicit head counts
    expect(effectiveGqaRatio(modelEntry({ headCount: 32, kvHeadCount: 8 }))).toBe(0.25)
    expect(effectiveGqaRatio(modelEntry({ headCount: 64, kvHeadCount: 8 }))).toBe(0.125)
    expect(effectiveGqaRatio(modelEntry({ headCount: 32, kvHeadCount: 32 }))).toBe(1.0)

    // Architecture family heuristics
    expect(effectiveGqaRatio(modelEntry({ architectureFamily: "llama" }))).toBe(0.25)
    expect(effectiveGqaRatio(modelEntry({ architectureFamily: "qwen" }))).toBe(0.20)
    expect(effectiveGqaRatio(modelEntry({ architectureFamily: "mistral" }))).toBe(0.25)
    expect(effectiveGqaRatio(modelEntry({ architectureFamily: "mixtral" }))).toBe(0.25)
    expect(effectiveGqaRatio(modelEntry({ architectureFamily: "gemma" }))).toBe(0.50)
    expect(effectiveGqaRatio(modelEntry({ architectureFamily: "deepseek" }))).toBe(0.15)
    expect(effectiveGqaRatio(modelEntry({ architectureFamily: "unknown-arch" }))).toBe(1.0)
  })

  it("scales KV-cache footprint down proportionally when GQA is present", () => {
    const mhaModel = modelEntry({
      sizeBytes: 40 * 1024 ** 3,
      paramCount: 70_000_000_000,
      headCount: 64,
      kvHeadCount: 64, // MHA 1:1
      quantization: "Q4_K_M"
    })
    const gqaModel = modelEntry({
      sizeBytes: 40 * 1024 ** 3,
      paramCount: 70_000_000_000,
      headCount: 64,
      kvHeadCount: 8, // GQA 8:1 (0.125)
      quantization: "Q4_K_M"
    })

    const fpMha = estimateFootprintGiB(mhaModel, 131072)
    const fpGqa = estimateFootprintGiB(gqaModel, 131072)

    // GQA footprint should be substantially smaller than MHA on long context
    expect(fpGqa).toBeLessThan(fpMha)
    expect(fpMha - fpGqa).toBeGreaterThan(20) // Saves >20 GiB of KV cache at 128K context
  })

  it("provides minimum OS headroom reserves scaled by machine unified memory tier", () => {
    expect(minOsHeadroomGiB(8)).toBe(3.0)
    expect(minOsHeadroomGiB(16)).toBe(4.0)
    expect(minOsHeadroomGiB(24)).toBe(6.0)
    expect(minOsHeadroomGiB(36)).toBe(6.0)
    expect(minOsHeadroomGiB(48)).toBe(8.0)
    expect(minOsHeadroomGiB(64)).toBe(8.0)
    expect(minOsHeadroomGiB(128)).toBe(10.0)
  })

  it("evaluates real-world model tiers across unified memory constraints", () => {
    // 1. Llama 3.1 8B 4-bit (~5.5 GiB weights, GQA 0.25)
    const llama8b = modelEntry({
      id: "meta-llama/Llama-3.1-8B-Instruct",
      sizeBytes: 5.5 * 1024 ** 3,
      paramCount: 8_000_000_000,
      headCount: 32,
      kvHeadCount: 8,
      trainedContextLength: 131072,
      quantization: "Q4_K_M",
      metadataSource: "gguf_header"
    })

    // On 8 GB Mac: risky (weights + activations occupy ~90% of memory, leaves <1GB for OS)
    const rec8bOn8gb = buildRecommendation(llama8b, machineProfile(8))
    expect(rec8bOn8gb.fitBand).toBe("risky")
    expect(rec8bOn8gb.presetHint).toBe("fast")

    // On 16 GB Mac: fits comfortably
    const rec8bOn16gb = buildRecommendation(llama8b, machineProfile(16))
    expect(rec8bOn16gb.fitBand).toBe("comfortable")
    expect(rec8bOn16gb.recommendedContext).toBe(8192)

    // 2. Qwen 2.5 32B 4-bit (~20 GiB weights, GQA 0.20)
    const qwen32b = modelEntry({
      id: "Qwen/Qwen2.5-32B-Instruct",
      sizeBytes: 20 * 1024 ** 3,
      paramCount: 32_000_000_000,
      headCount: 40,
      kvHeadCount: 8,
      trainedContextLength: 131072,
      quantization: "Q4_K_M",
      metadataSource: "gguf_header"
    })

    // On 16 GB Mac: risky (weights exceed total memory)
    const rec32bOn16gb = buildRecommendation(qwen32b, machineProfile(16))
    expect(rec32bOn16gb.fitBand).toBe("risky")

    // On 36 GB Mac: tight fit (leaves ~11GB headroom)
    const rec32bOn36gb = buildRecommendation(qwen32b, machineProfile(36))
    expect(rec32bOn36gb.fitBand).toBe("tight")
    expect(rec32bOn36gb.recommendedContext).toBeGreaterThanOrEqual(16384)

    // On 48 GB Mac: comfortable
    const rec32bOn48gb = buildRecommendation(qwen32b, machineProfile(48))
    expect(rec32bOn48gb.fitBand).toBe("comfortable")
    expect(rec32bOn48gb.recommendedContext).toBeGreaterThanOrEqual(32768)

    // 3. Llama 3.1 70B 4-bit (~42 GiB weights, GQA 0.125)
    const llama70b = modelEntry({
      id: "meta-llama/Llama-3.1-70B-Instruct",
      sizeBytes: 42 * 1024 ** 3,
      paramCount: 70_000_000_000,
      headCount: 64,
      kvHeadCount: 8,
      trainedContextLength: 131072,
      quantization: "Q4_K_M",
      metadataSource: "gguf_header"
    })

    // On 64 GB Mac: tight fit (42 GiB weights leaves ~14 GiB headroom)
    const rec70bOn64gb = buildRecommendation(llama70b, machineProfile(64))
    expect(rec70bOn64gb.fitBand).toBe("tight")
    expect(rec70bOn64gb.recommendedContext).toBe(16384)

    // On 128 GB Mac: comfortable
    const rec70bOn128gb = buildRecommendation(llama70b, machineProfile(128))
    expect(rec70bOn128gb.fitBand).toBe("comfortable")
    expect(rec70bOn128gb.recommendedContext).toBe(131072)
  })

  it("handles fallback activeParams when isMoe is true without explicit activeParams", () => {
    const moeDefault = modelEntry({
      sizeBytes: 16 * 1024 ** 3,
      isMoe: true,
      paramCount: 40_000_000_000
    })
    const footprint = estimateFootprintGiB(moeDefault, 8192)
    expect(footprint).toBeGreaterThan(16)
  })

  it("handles KV cache quantization factors for MLX kvBits=4 and llama cacheTypeK", () => {
    const mlx4 = modelEntry({
      runtime: "mlx",
      sizeBytes: 8 * 1024 ** 3,
      formula: { runtime: "mlx", mlx: { kvBits: 4 } }
    })
    const llamaQ8 = modelEntry({
      runtime: "llama.cpp",
      sizeBytes: 8 * 1024 ** 3,
      formula: { runtime: "llama.cpp", llama: { cacheTypeK: "q8_0" } }
    })
    const llamaQ4 = modelEntry({
      runtime: "llama.cpp",
      sizeBytes: 8 * 1024 ** 3,
      formula: { runtime: "llama.cpp", llama: { cacheTypeK: "q4_0" } }
    })

    expect(estimateFootprintGiB(mlx4, 32768)).toBeLessThan(estimateFootprintGiB(llamaQ8, 32768))
    expect(estimateFootprintGiB(llamaQ4, 32768)).toBeLessThan(estimateFootprintGiB(llamaQ8, 32768))
  })

  it("appends MTP recommendation note for llama models with MTP in slug", () => {
    const mtpModel = modelEntry({
      id: "deepseek/DeepSeek-V3-MTP",
      slug: "deepseek-v3-mtp",
      runtime: "llama.cpp",
      sizeBytes: 20 * 1024 ** 3
    })
    const rec = buildRecommendation(mtpModel, machineProfile(64))
    expect(rec.explanation).toContain("Multi-Token Prediction (MTP)")
    expect(rec.explanation).toContain("spec-type=draft-mtp")
  })
})
