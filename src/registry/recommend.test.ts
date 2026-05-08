import { describe, it, expect } from "vitest"
import { buildRecommendation } from "./recommend.js"
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
    expect(rec.estimatedFootprintGiB).toBeCloseTo(2.7, 5)
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
    expect(rec.recommendedContextNote).toBe("trained context unknown; using conservative default")
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

  it("suggests coding when context headroom is large", () => {
    const rec = buildRecommendation(modelEntry({
      sizeBytes: 4 * 1024 ** 3,
      trainedContextLength: 65536,
      metadataSource: "gguf_header"
    }), machineProfile(32))

    expect(rec.recommendedContext).toBe(16384)
    expect(rec.presetHint).toBe("coding")
  })
})
