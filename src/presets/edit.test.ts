import { describe, it, expect } from "vitest"
import { parseKvTokens, setPresetFields, unsetPresetFields, listKeys, validateLlamaSpeculativeConfig } from "./edit.js"
import type { ModelEntry } from "../types/index.js"

function mlxEntry(overrides: Partial<ModelEntry> = {}): ModelEntry {
  return {
    id: "a", slug: "a", path: "/m/a", runtime: "mlx",
    source: { type: "hf", repo: "a" }, port: 8081,
    publish: true, addedAt: 0, ...overrides
  }
}

function llamaEntry(overrides: Partial<ModelEntry> = {}): ModelEntry {
  return {
    id: "b", slug: "b", path: "/m/b.gguf", runtime: "llama.cpp",
    source: { type: "local" }, port: 8082,
    publish: true, addedAt: 0, ...overrides
  }
}

describe("parseKvTokens", () => {
  it("parses tokens of the form key=value", () => {
    expect(parseKvTokens(["ctx-size=32768", "n-gpu-layers=48"]))
      .toEqual([["ctx-size", "32768"], ["n-gpu-layers", "48"]])
  })
  it("tolerates values containing additional equal signs", () => {
    expect(parseKvTokens(["x=a=b=c"])).toEqual([["x", "a=b=c"]])
  })
  it("throws on tokens without =", () => {
    expect(() => parseKvTokens(["bare"])).toThrow(/expected key=value/)
  })
})

describe("setPresetFields", () => {
  it("accepts flag-style and JSON-style aliases", () => {
    const p = setPresetFields(llamaEntry(), [
      ["ctx-size", "32768"],
      ["nGpuLayers", "48"],
      ["ngl", "32"]
    ])
    expect(p.runtime).toBe("llama.cpp")
    if (p.runtime !== "llama.cpp") throw new Error()
    expect(p.llama.ctxSize).toBe(32768)
    // Last write wins (ngl is an alias for nGpuLayers).
    expect(p.llama.nGpuLayers).toBe(32)
  })

  it("merges on top of an existing preset rather than replacing it", () => {
    const entry = llamaEntry({
      preset: { runtime: "llama.cpp", llama: { ctxSize: 8192, parallel: 4 } }
    })
    const p = setPresetFields(entry, [["parallel", "2"]])
    if (p.runtime !== "llama.cpp") throw new Error()
    expect(p.llama).toEqual({ ctxSize: 8192, parallel: 2 })
  })

  it("switches runtime preset when entry runtime changes", () => {
    const entry = mlxEntry({
      preset: { runtime: "llama.cpp", llama: { ctxSize: 1 } }
    })
    const p = setPresetFields(entry, [["decode-concurrency", "4"]])
    expect(p.runtime).toBe("mlx")
    if (p.runtime !== "mlx") throw new Error()
    expect(p.mlx.decodeConcurrency).toBe(4)
  })

  it("rejects unknown keys and non-numeric values", () => {
    expect(() => setPresetFields(llamaEntry(), [["not-a-key", "1"]]))
      .toThrow(/unknown llama.cpp preset key/)
    expect(() => setPresetFields(llamaEntry(), [["ctx-size", "not-a-number"]]))
      .toThrow(/expected a number/)
  })

  it("rejects keys from the wrong runtime", () => {
    expect(() => setPresetFields(mlxEntry(), [["ctx-size", "4"]]))
      .toThrow(/unknown mlx preset key/)
  })

  it("accepts string-based and float speculative decoding settings", () => {
    const p = setPresetFields(llamaEntry(), [
      ["spec-type", "draft-mtp"],
      ["spec-draft-model", "/models/draft.gguf"],
      ["spec-draft-p-min", "0.85"]
    ])
    expect(p.runtime).toBe("llama.cpp")
    if (p.runtime !== "llama.cpp") throw new Error()
    expect(p.llama.specType).toBe("draft-mtp")
    expect(p.llama.specDraftModel).toBe("/models/draft.gguf")
    expect(p.llama.specDraftPMin).toBe(0.85)
  })
})

describe("unsetPresetFields", () => {
  it("removes named keys and keeps others", () => {
    const entry = llamaEntry({
      preset: { runtime: "llama.cpp", llama: { ctxSize: 8192, parallel: 4 } }
    })
    const p = unsetPresetFields(entry, ["parallel"])!
    if (p.runtime !== "llama.cpp") throw new Error()
    expect(p.llama).toEqual({ ctxSize: 8192 })
  })

  it("returns undefined when all keys are removed", () => {
    const entry = llamaEntry({
      preset: { runtime: "llama.cpp", llama: { ctxSize: 8192 } }
    })
    expect(unsetPresetFields(entry, ["ctx-size"])).toBeUndefined()
  })

  it("returns undefined when the entry has no matching preset", () => {
    expect(unsetPresetFields(llamaEntry(), ["ctx-size"])).toBeUndefined()
  })
})

describe("listKeys", () => {
  it("scopes keys by runtime", () => {
    const mlx = listKeys("mlx").map(k => k.jsonName)
    const llama = listKeys("llama.cpp").map(k => k.jsonName)
    expect(mlx).toContain("decodeConcurrency")
    expect(mlx).not.toContain("ctxSize")
    expect(llama).toContain("ctxSize")
    expect(llama).not.toContain("decodeConcurrency")
  })
})

describe("validateLlamaSpeculativeConfig", () => {
  const baseLlama = {
    nGpuLayers: 999,
    ctxSize: 8192,
    batchSize: 512,
    ubatchSize: 128,
    parallel: 1
  }

  it("returns empty warnings for a normal config without speculative settings", () => {
    expect(validateLlamaSpeculativeConfig(baseLlama, llamaEntry())).toEqual([])
  })

  it("warns if speculative properties are set but specType is none or undefined", () => {
    const warnings1 = validateLlamaSpeculativeConfig({
      ...baseLlama,
      specDraftNMax: 4
    }, llamaEntry())
    expect(warnings1).toContain("spec-draft parameters are configured but speculative-mode is not enabled and spec-type is not set (or is \"none\"). Speculative decoding will not be active.")

    const warnings2 = validateLlamaSpeculativeConfig({
      ...baseLlama,
      specType: "none",
      specDraftModel: "/some/draft.gguf"
    }, llamaEntry())
    expect(warnings2).toContain("spec-draft parameters are configured but speculative-mode is not enabled and spec-type is not set (or is \"none\"). Speculative decoding will not be active.")
  })

  it("warns if specType is draft/simple/eagle/dflash but specDraftModel is missing", () => {
    const warnings = validateLlamaSpeculativeConfig({
      ...baseLlama,
      specType: "draft"
    }, llamaEntry())
    expect(warnings).toContain("spec-type \"draft\" requires a speculative draft model path set via spec-draft-model.")
  })

  it("warns if specType is draft-mtp but specDraftModel is provided", () => {
    const warnings = validateLlamaSpeculativeConfig({
      ...baseLlama,
      specType: "draft-mtp",
      specDraftModel: "/some/draft.gguf"
    }, llamaEntry())
    expect(warnings).toContain("spec-type \"draft-mtp\" (Multi-Token Prediction) does not require a separate spec-draft-model (draft heads are built-in). The specified model \"/some/draft.gguf\" might be ignored.")
  })

  it("returns no warnings for correct spec draft configurations", () => {
    const warningsDraft = validateLlamaSpeculativeConfig({
      ...baseLlama,
      specType: "draft",
      specDraftModel: "/some/draft.gguf"
    }, llamaEntry())
    expect(warningsDraft).toEqual([])

    const warningsMtp = validateLlamaSpeculativeConfig({
      ...baseLlama,
      specType: "draft-mtp"
    }, llamaEntry())
    expect(warningsMtp).toEqual([])
  })

  it("validates MTP capability-based modes", () => {
    // Model has MTP capability but speculativeMode is disabled
    const entryWithMtp = llamaEntry({ capabilities: ["mtp"] })
    const warningsDisabled = validateLlamaSpeculativeConfig({
      ...baseLlama,
      speculativeMode: "disabled"
    }, entryWithMtp)
    expect(warningsDisabled).toContain("Model has Multi-Token Prediction (MTP) capability, but speculative-mode is set to 'disabled'. MTP will not be enabled.")

    // Model lacks MTP capability but speculativeMode is enabled
    const entryWithoutMtp = llamaEntry({ capabilities: [] })
    const warningsEnabled = validateLlamaSpeculativeConfig({
      ...baseLlama,
      speculativeMode: "enabled"
    }, entryWithoutMtp)
    expect(warningsEnabled).toContain("speculative-mode is set to 'enabled' but the model has no detected Multi-Token Prediction (MTP) capability.")

    // Model has MTP capability and speculativeMode is auto (no warnings)
    const warningsAuto = validateLlamaSpeculativeConfig({
      ...baseLlama,
      speculativeMode: "auto"
    }, entryWithMtp)
    expect(warningsAuto).toEqual([])
  })
})
