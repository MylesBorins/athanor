import type { ModelEntry, RuntimePreset, RuntimeType } from "../types/index.js"
import { setPresetFields, unsetPresetFields } from "./edit.js"

export interface CompoundOption {
  key: string
  label: string
}

export interface CompoundKnob {
  id: "contextWindow" | "kvCache" | "speculative" | "samplingMode" | "gpuOffload"
  label: string
  runtimes: RuntimeType[]
  options: CompoundOption[]
}

export const COMPOUND_KNOBS: CompoundKnob[] = [
  {
    id: "contextWindow",
    label: "Context Window",
    runtimes: ["llama.cpp", "mlx"],
    options: [
      { key: "8192", label: "8K" },
      { key: "16384", label: "16K" },
      { key: "32768", label: "32K" },
      { key: "65536", label: "64K" },
      { key: "131072", label: "128K" },
      { key: "262144", label: "256K" }
    ]
  },
  {
    id: "kvCache",
    label: "KV Cache",
    runtimes: ["llama.cpp"],
    options: [
      { key: "f16", label: "f16 (default)" },
      { key: "q8_0", label: "q8_0 (half RAM)" },
      { key: "q4_0", label: "q4_0" }
    ]
  },
  {
    id: "speculative",
    label: "Speculative",
    runtimes: ["llama.cpp"],
    options: [
      { key: "off", label: "off" },
      { key: "auto", label: "auto" },
      { key: "mtp", label: "mtp" },
      { key: "draft", label: "draft model" }
    ]
  },
  {
    id: "samplingMode",
    label: "Sampling Mode",
    runtimes: ["llama.cpp", "mlx"],
    options: [
      { key: "balanced", label: "balanced" },
      { key: "thinking", label: "thinking" },
      { key: "instruct", label: "instruct" },
      { key: "deterministic", label: "deterministic" },
      { key: "creative", label: "creative" }
    ]
  },
  {
    id: "gpuOffload",
    label: "GPU Offload",
    runtimes: ["llama.cpp"],
    options: [
      { key: "all", label: "all (999)" },
      { key: "cpu", label: "cpu only (0)" }
    ]
  }
]

export interface PresetCategory {
  name: string
  keys: string[]
}

export const CATEGORIES_LLAMA: PresetCategory[] = [
  {
    name: "HARDWARE & CONTEXT",
    keys: ["ctxSize", "nGpuLayers", "parallel", "batchSize", "ubatchSize"]
  },
  {
    name: "MEMORY & KV CACHE",
    keys: ["cacheTypeK", "cacheTypeV", "flashAttn"]
  },
  {
    name: "SAMPLING & PENALTIES",
    keys: ["temp", "topP", "topK", "minP", "presencePenalty", "repeatPenalty", "frequencyPenalty", "repeatLastN"]
  },
  {
    name: "SPECULATIVE DECODING",
    keys: ["speculativeMode", "specType", "specDraftNgl", "specDraftNMax", "specDraftNMin", "specDraftPSplit", "specDraftPMin", "specDraftModel", "specDraftCacheTypeK", "specDraftCacheTypeV"]
  }
]

export const CATEGORIES_MLX: PresetCategory[] = [
  {
    name: "HARDWARE & CONTEXT",
    keys: ["contextWindow", "decodeConcurrency", "prefillStepSize", "promptConcurrency"]
  },
  {
    name: "MEMORY & CACHE",
    keys: ["promptCacheBytes", "promptCacheSize"]
  },
  {
    name: "SAMPLING & OUTPUT",
    keys: ["temp", "topP", "topK", "minP", "maxTokens"]
  }
]

export function getCategoriesForRuntime(runtime: RuntimeType): PresetCategory[] {
  return runtime === "mlx" ? CATEGORIES_MLX : CATEGORIES_LLAMA
}

function numEqual(a: unknown, b: unknown, tol = 1e-4): boolean {
  if (typeof a !== "number" || typeof b !== "number") return a === b
  return Math.abs(a - b) < tol
}

export function inferCompoundState(
  entry: ModelEntry,
  effective: Record<string, unknown>
): Record<string, string> {
  const result: Record<string, string> = {}

  // 1. Context Window
  const ctxVal = entry.runtime === "mlx" ? effective.contextWindow : effective.ctxSize
  if (ctxVal !== undefined) {
    const s = String(ctxVal)
    const known = COMPOUND_KNOBS.find(k => k.id === "contextWindow")?.options.some(o => o.key === s)
    result.contextWindow = known ? s : "custom"
  } else {
    result.contextWindow = "65536"
  }

  // 2. KV Cache (llama only)
  if (entry.runtime === "llama.cpp") {
    const k = effective.cacheTypeK
    const v = effective.cacheTypeV
    if ((!k || k === "f16") && (!v || v === "f16")) {
      result.kvCache = "f16"
    } else if (k === "q8_0" && v === "q8_0") {
      result.kvCache = "q8_0"
    } else if (k === "q4_0" && v === "q4_0") {
      result.kvCache = "q4_0"
    } else {
      result.kvCache = "custom"
    }
  }

  // 3. Speculative (llama only)
  if (entry.runtime === "llama.cpp") {
    const mode = effective.speculativeMode
    const specType = effective.specType
    if (mode === "disabled") {
      result.speculative = "off"
    } else if (mode === "enabled" || specType === "draft-mtp") {
      result.speculative = "mtp"
    } else if (specType === "draft" || effective.specDraftModel) {
      result.speculative = "draft"
    } else {
      result.speculative = "auto"
    }
  }

  // 4. Sampling Mode
  const temp = effective.temp
  const topP = effective.topP
  const topK = effective.topK
  const minP = effective.minP
  const pres = effective.presencePenalty
  const rep = effective.repeatPenalty

  if (entry.runtime === "llama.cpp") {
    if (numEqual(temp, 1.0) && numEqual(topP, 0.95) && numEqual(topK, 20) && numEqual(minP, 0.0) && numEqual(pres, 0.0) && numEqual(rep, 1.0)) {
      result.samplingMode = "thinking"
    } else if (numEqual(temp, 0.7) && numEqual(topP, 0.80) && numEqual(topK, 20) && numEqual(minP, 0.0) && numEqual(pres, 1.5) && numEqual(rep, 1.0)) {
      result.samplingMode = "instruct"
    } else if (numEqual(temp, 0.8) && numEqual(topP, 0.95) && numEqual(topK, 40) && numEqual(minP, 0.05) && numEqual(pres, 0.0) && numEqual(rep, 1.0)) {
      result.samplingMode = "balanced"
    } else if (numEqual(temp, 0.0) && numEqual(topP, 1.0) && numEqual(topK, 0) && numEqual(minP, 0.0)) {
      result.samplingMode = "deterministic"
    } else if (numEqual(temp, 1.1) && numEqual(topP, 0.95) && numEqual(topK, 50) && numEqual(minP, 0.05) && numEqual(pres, 0.5) && numEqual(rep, 1.05)) {
      result.samplingMode = "creative"
    } else {
      result.samplingMode = "custom"
    }
  } else {
    // MLX
    if (numEqual(temp, 1.0) && numEqual(topP, 0.95) && numEqual(topK, 20) && numEqual(minP, 0.0)) {
      result.samplingMode = "thinking"
    } else if (numEqual(temp, 0.7) && numEqual(topP, 0.80) && numEqual(topK, 20) && numEqual(minP, 0.0)) {
      result.samplingMode = "instruct"
    } else if (numEqual(temp, 0.8) && numEqual(topP, 0.95) && numEqual(topK, 40) && numEqual(minP, 0.05)) {
      result.samplingMode = "balanced"
    } else if (numEqual(temp, 0.0) && numEqual(topP, 1.0) && numEqual(topK, 0) && numEqual(minP, 0.0)) {
      result.samplingMode = "deterministic"
    } else if (numEqual(temp, 1.1) && numEqual(topP, 0.95) && numEqual(topK, 50) && numEqual(minP, 0.05)) {
      result.samplingMode = "creative"
    } else {
      result.samplingMode = "custom"
    }
  }

  // 5. GPU Offload (llama only)
  if (entry.runtime === "llama.cpp") {
    const ngl = effective.nGpuLayers
    if (typeof ngl === "number" && ngl >= 999) {
      result.gpuOffload = "all"
    } else if (ngl === 0) {
      result.gpuOffload = "cpu"
    } else {
      result.gpuOffload = "custom"
    }
  }

  return result
}

export function applyCompoundSelection(
  entry: ModelEntry,
  knobId: CompoundKnob["id"],
  choiceKey: string
): RuntimePreset | undefined {
  if (knobId === "contextWindow") {
    const field = entry.runtime === "mlx" ? "context-window" : "ctx-size"
    return setPresetFields(entry, [[field, choiceKey]])
  }

  if (knobId === "kvCache") {
    if (choiceKey === "f16") {
      return unsetPresetFields(entry, ["cacheTypeK", "cacheTypeV"])
    }
    if (choiceKey === "q8_0" || choiceKey === "q4_0") {
      return setPresetFields(entry, [
        ["cache-type-k", choiceKey],
        ["cache-type-v", choiceKey],
        ["flash-attn", "on"]
      ])
    }
  }

  if (knobId === "speculative") {
    if (choiceKey === "off") {
      return setPresetFields(entry, [["speculative-mode", "disabled"]])
    }
    if (choiceKey === "auto") {
      return setPresetFields(entry, [["speculative-mode", "auto"]])
    }
    if (choiceKey === "mtp") {
      return setPresetFields(entry, [
        ["speculative-mode", "enabled"],
        ["spec-type", "draft-mtp"],
        ["spec-draft-ngl", "999"]
      ])
    }
    if (choiceKey === "draft") {
      return setPresetFields(entry, [["spec-type", "draft"]])
    }
  }

  if (knobId === "samplingMode") {
    if (choiceKey === "thinking") {
      if (entry.runtime === "llama.cpp") {
        return setPresetFields(entry, [
          ["temp", "1.0"],
          ["top-p", "0.95"],
          ["top-k", "20"],
          ["min-p", "0.0"],
          ["presence-penalty", "0.0"],
          ["repeat-penalty", "1.0"],
          ["repeat-last-n", "64"]
        ])
      }
      return setPresetFields(entry, [
        ["temp", "1.0"],
        ["top-p", "0.95"],
        ["top-k", "20"],
        ["min-p", "0.0"]
      ])
    }
    if (choiceKey === "instruct") {
      if (entry.runtime === "llama.cpp") {
        return setPresetFields(entry, [
          ["temp", "0.7"],
          ["top-p", "0.80"],
          ["top-k", "20"],
          ["min-p", "0.0"],
          ["presence-penalty", "1.5"],
          ["repeat-penalty", "1.0"],
          ["repeat-last-n", "64"]
        ])
      }
      return setPresetFields(entry, [
        ["temp", "0.7"],
        ["top-p", "0.80"],
        ["top-k", "20"],
        ["min-p", "0.0"]
      ])
    }
    if (choiceKey === "balanced") {
      if (entry.runtime === "llama.cpp") {
        return setPresetFields(entry, [
          ["temp", "0.8"],
          ["top-p", "0.95"],
          ["top-k", "40"],
          ["min-p", "0.05"],
          ["presence-penalty", "0.0"],
          ["repeat-penalty", "1.0"],
          ["repeat-last-n", "64"]
        ])
      }
      return setPresetFields(entry, [
        ["temp", "0.8"],
        ["top-p", "0.95"],
        ["top-k", "40"],
        ["min-p", "0.05"]
      ])
    }
    if (choiceKey === "deterministic") {
      if (entry.runtime === "llama.cpp") {
        return setPresetFields(entry, [
          ["temp", "0.0"],
          ["top-p", "1.0"],
          ["top-k", "0"],
          ["min-p", "0.0"],
          ["presence-penalty", "0.0"],
          ["repeat-penalty", "1.0"],
          ["repeat-last-n", "64"]
        ])
      }
      return setPresetFields(entry, [
        ["temp", "0.0"],
        ["top-p", "1.0"],
        ["top-k", "0"],
        ["min-p", "0.0"]
      ])
    }
    if (choiceKey === "creative") {
      if (entry.runtime === "llama.cpp") {
        return setPresetFields(entry, [
          ["temp", "1.1"],
          ["top-p", "0.95"],
          ["top-k", "50"],
          ["min-p", "0.05"],
          ["presence-penalty", "0.5"],
          ["repeat-penalty", "1.05"],
          ["repeat-last-n", "64"]
        ])
      }
      return setPresetFields(entry, [
        ["temp", "1.1"],
        ["top-p", "0.95"],
        ["top-k", "50"],
        ["min-p", "0.05"]
      ])
    }
  }

  if (knobId === "gpuOffload") {
    if (choiceKey === "all") {
      return setPresetFields(entry, [["n-gpu-layers", "999"]])
    }
    if (choiceKey === "cpu") {
      return setPresetFields(entry, [["n-gpu-layers", "0"]])
    }
  }

  return entry.formula ?? entry.preset
}
