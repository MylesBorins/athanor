import { describe, expect, it } from "vitest"
import type { MachineProfile } from "../machine/profile.js"
import type { SearchResult, SearchSelectionHint } from "./hf.js"
import { buildSearchRecommendation, sortByFit } from "./recommend.js"

function makeMachine(totalMemoryGiB: number = 32): MachineProfile {
  return {
    totalMemoryBytes: totalMemoryGiB * 1024 ** 3,
    totalMemoryGiB,
    chip: "Apple M4 Max"
  }
}

function makeResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    id: "org/test-model",
    likes: 10,
    downloads: 100,
    lastModified: "2026-01-01",
    tags: [],
    ...overrides
  }
}

describe("buildSearchRecommendation", () => {
  it("returns null when result has no runtime", () => {
    const res = makeResult({ runtime: undefined, sizeBytes: 1024 * 1024 * 1024 })
    expect(buildSearchRecommendation(res, makeMachine())).toBeNull()
  })

  it("returns null when result and hint have no sizeBytes", () => {
    const res = makeResult({ runtime: "mlx", sizeBytes: undefined })
    expect(buildSearchRecommendation(res, makeMachine())).toBeNull()
  })

  it("builds a search recommendation for MLX models with mlx_config metadata source", () => {
    const res = makeResult({
      id: "mlx-community/Qwen2.5-7B-Instruct-4bit",
      runtime: "mlx",
      sizeBytes: 4 * 1024 * 1024 * 1024
    })
    const rec = buildSearchRecommendation(res, makeMachine(32))
    expect(rec).not.toBeNull()
    expect(rec?.runnable).toBe(true)
    expect(rec?.runtimeLabel).toBe("mlx")
    expect(rec?.fitBand).toBe("comfortable")
    expect(rec?.confidence).toBe("high") // mlx_config is high confidence
  })

  it("builds a recommendation for GGUF models prioritizing hint.defaultFileSizeBytes", () => {
    const res = makeResult({
      id: "bartowski/Llama-3.2-3B-Instruct-GGUF",
      runtime: "llama.cpp",
      sizeBytes: 20 * 1024 * 1024 * 1024
    })
    const hint: SearchSelectionHint = {
      defaultFileSizeBytes: 2 * 1024 * 1024 * 1024,
      ggufContextLength: 16384
    }
    const rec = buildSearchRecommendation(res, makeMachine(16), hint)
    expect(rec).not.toBeNull()
    expect(rec?.runnable).toBe(true)
    expect(rec?.runtimeLabel).toBe("llama.cpp")
    expect(rec?.fitBand).toBe("comfortable")
  })

  it("handles undefined metadataSource when result sizeBytes is undefined", () => {
    const res = makeResult({
      id: "bartowski/model-GGUF",
      runtime: "llama.cpp",
      sizeBytes: undefined
    })
    const hint: SearchSelectionHint = {
      defaultFileSizeBytes: 1024 ** 3
    }
    const rec = buildSearchRecommendation(res, makeMachine(16), hint)
    expect(rec).not.toBeNull()
    expect(rec?.confidence).toBe("medium")
  })

  it("handles other unknown runtime with undefined metadataSource", () => {
    const res = makeResult({
      id: "org/model-custom",
      runtime: "custom" as any,
      sizeBytes: 1024 ** 3
    })
    const rec = buildSearchRecommendation(res, makeMachine(16))
    expect(rec).not.toBeNull()
    expect(rec?.confidence).toBe("medium")
  })

  it("infers quantization formats correctly from repo id", () => {
    const q4 = makeResult({
      id: "org/model-Q4_K_M-GGUF",
      runtime: "llama.cpp",
      sizeBytes: 4 * 1024 * 1024 * 1024
    })
    const recQ4 = buildSearchRecommendation(q4, makeMachine())
    expect(recQ4?.explanation).toContain("4-bit balanced quant")

    const q8 = makeResult({
      id: "org/model-Q8_0-GGUF",
      runtime: "llama.cpp",
      sizeBytes: 8 * 1024 * 1024 * 1024
    })
    const recQ8 = buildSearchRecommendation(q8, makeMachine())
    expect(recQ8?.explanation).toContain("8-bit quant")

    const q5 = makeResult({
      id: "org/model-Q5_K_M",
      runtime: "llama.cpp",
      sizeBytes: 5 * 1024 * 1024 * 1024
    })
    const recQ5 = buildSearchRecommendation(q5, makeMachine())
    expect(recQ5).not.toBeNull()
  })

  it("handles sourceFallback === 'exact-repo' with file_size_only metadataSource", () => {
    const res = makeResult({
      id: "org/exact-repo-model",
      runtime: "mlx",
      sourceFallback: "exact-repo",
      sizeBytes: 3 * 1024 * 1024 * 1024
    })
    const rec = buildSearchRecommendation(res, makeMachine(16))
    expect(rec).not.toBeNull()
    expect(rec?.confidence).toBe("low") // file_size_only leads to low confidence
  })
})

describe("sortByFit", () => {
  it("sorts by fit band: comfortable > tight > risky", () => {
    const machine = makeMachine(16)
    // 2GB is comfortable on 16GB
    const comfortable = makeResult({ id: "org/small", runtime: "mlx", sizeBytes: 2 * 1024 ** 3 })
    // 9GB is tight on 16GB
    const tight = makeResult({ id: "org/medium", runtime: "mlx", sizeBytes: 9 * 1024 ** 3 })
    // 30GB is risky on 16GB
    const risky = makeResult({ id: "org/huge", runtime: "mlx", sizeBytes: 30 * 1024 ** 3 })

    const sorted = sortByFit([risky, comfortable, tight], machine)
    expect(sorted.map(s => s.id)).toEqual(["org/small", "org/medium", "org/huge"])
  })

  it("breaks ties by confidence rank, sizeBytes ascending, and downloads descending", () => {
    const machine = makeMachine(32)
    const hints: Record<string, SearchSelectionHint> = {
      "org/with-hint": {
        ggufTotalSizeBytes: 3 * 1024 ** 3,
        ggufContextLength: 8192
      }
    }
    const withHint = makeResult({
      id: "org/with-hint",
      runtime: "llama.cpp",
      sizeBytes: 3 * 1024 ** 3,
      downloads: 50
    })
    const exactFallback = makeResult({
      id: "org/exact",
      runtime: "mlx",
      sourceFallback: "exact-repo",
      sizeBytes: 3 * 1024 ** 3,
      downloads: 100
    })

    // Both are comfortable, but withHint has gguf_header (high/medium confidence) while exact-repo is low confidence
    const sorted = sortByFit([exactFallback, withHint], machine, hints)
    expect(sorted[0]?.id).toBe("org/with-hint")

    // Same fit band and confidence: smaller size wins
    const smaller = makeResult({ id: "org/a-small", runtime: "mlx", sizeBytes: 2 * 1024 ** 3, downloads: 10 })
    const larger = makeResult({ id: "org/b-larger", runtime: "mlx", sizeBytes: 4 * 1024 ** 3, downloads: 100 })
    expect(sortByFit([larger, smaller], machine).map(s => s.id)).toEqual(["org/a-small", "org/b-larger"])

    // Same size and fit band: higher downloads wins
    const pop1 = makeResult({ id: "org/pop1", runtime: "mlx", sizeBytes: 2 * 1024 ** 3, downloads: 500 })
    const pop2 = makeResult({ id: "org/pop2", runtime: "mlx", sizeBytes: 2 * 1024 ** 3, downloads: 1000 })
    expect(sortByFit([pop1, pop2], machine).map(s => s.id)).toEqual(["org/pop2", "org/pop1"])
  })
})
