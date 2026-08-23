/**
 * Mathematical equations, constants, and VRAM estimation heuristics are adapted
 * from whichllm under the MIT License:
 * Copyright (c) 2026 Andyyyy64
 * https://github.com/Andyyyy64/whichllm
 */

import type { MetadataSource, ModelEntry } from "../types/index.js"
import type { MachineProfile } from "../machine/profile.js"

export type FitBand = "comfortable" | "tight" | "risky"
export type RecommendationConfidence = "high" | "medium" | "low"

export interface Recommendation {
  fitBand: FitBand
  estimatedFootprintGiB: number
  recommendedContext: number
  recommendedContextNote: string
  confidence: RecommendationConfidence
  explanation: string
  presetHint?: "fast" | "balanced" | "long-context"
  presetHintReason?: string
}

const COMFORTABLE_THRESHOLD = 0.60
const TIGHT_THRESHOLD = 0.75

// Empirical KV-cache coefficient: bytes per B-active-param per K-context-token
// for FP16 K/V tensors.
const KV_BYTES_PER_BPARAM_PER_KCTX = 3.5 * 1024 * 1024 // 3.5 MB
const MOE_ATTENTION_PARAM_MULTIPLIER = 4.0
const FRAMEWORK_OVERHEAD_BYTES = 500 * 1024 * 1024 // 500 MB

function estimateParamCount(entry: ModelEntry, _weightGiB: number): number {
  if (entry.paramCount) return entry.paramCount

  // Estimate parameter count based on quantization and file size.
  // 4-bit quants use roughly 0.5 bytes per parameter.
  // 8-bit quants use roughly 1.0 byte per parameter.
  // FP16/BF16 models use roughly 2.0 bytes per parameter.
  let bytesPerWeight = 2.0
  const q = entry.quantization?.toUpperCase()
  if (q) {
    if (q.includes("Q4") || q.includes("AWQ") || q.includes("GPTQ") || q.includes("4-BIT") || q.includes("4BIT")) {
      bytesPerWeight = 0.5
    } else if (q.includes("Q8") || q.includes("8-BIT") || q.includes("8BIT") || q.includes("INT8") || q.includes("FP8")) {
      bytesPerWeight = 1.0
    }
  } else {
    // Check if repo name or ID implies quantization
    const idLower = entry.id.toLowerCase()
    if (idLower.includes("4bit") || idLower.includes("awq") || idLower.includes("gptq") || idLower.includes("q4")) {
      bytesPerWeight = 0.5
    } else if (idLower.includes("8bit") || idLower.includes("int8") || idLower.includes("q8")) {
      bytesPerWeight = 1.0
    }
  }

  const weightBytes = entry.sizeBytes ?? 0
  return weightBytes / bytesPerWeight
}

function estimateActiveParams(entry: ModelEntry, totalParams: number): number {
  if (entry.activeParams) return entry.activeParams
  if (entry.isMoe) {
    // For Mixture of Experts, typically 10-25% of parameters are active per token.
    // Use 15% as a safe default proxy.
    return totalParams * 0.15
  }
  return totalParams
}

export function estimateFootprintGiB(entry: ModelEntry, contextLength: number): number {
  const weightGiB = (entry.sizeBytes ?? 0) / (1024 ** 3)
  const totalParams = estimateParamCount(entry, weightGiB)
  const activeParams = estimateActiveParams(entry, totalParams)

  // 1. Weight Size GiB
  const weightsGiB = weightGiB

  // 2. KV Cache Size GiB
  let kvQuantFactor = 1.0
  const activeFormula = entry.formula ?? entry.preset
  if (activeFormula?.runtime === "mlx") {
    if (activeFormula.mlx.kvBits === 8) kvQuantFactor = 0.5
    else if (activeFormula.mlx.kvBits === 4) kvQuantFactor = 0.25
  } else if (activeFormula?.runtime === "llama.cpp") {
    const k = activeFormula.llama.cacheTypeK
    if (k === "q8_0") kvQuantFactor = 0.5
    else if (k === "q4_0" || k === "q4_1" || k === "iq4_nl") kvQuantFactor = 0.25
  }

  // Active-params * MoE multiplier gives a reasonable proxy for attention layers
  const paramsB = entry.isMoe
    ? (activeParams / 1e9) * MOE_ATTENTION_PARAM_MULTIPLIER
    : (activeParams / 1e9)
  const ctxK = contextLength / 1024
  const kvBytes = paramsB * ctxK * KV_BYTES_PER_BPARAM_PER_KCTX * kvQuantFactor
  const kvGiB = kvBytes / (1024 ** 3)

  // 3. Activation Memory GiB
  const activationBase = 400 * 1024 * 1024 // 400 MB floor
  const activationParamTerm = activeParams * 0.08
  const activationCtxTerm = (contextLength / 4096) * 150 * 1024 * 1024
  const activationGiB = (activationBase + activationParamTerm + activationCtxTerm) / (1024 ** 3)

  // 4. Framework Overhead GiB
  const frameworkGiB = FRAMEWORK_OVERHEAD_BYTES / (1024 ** 3)

  return weightsGiB + kvGiB + activationGiB + frameworkGiB
}

function computeFitBand(estimatedFootprintGiB: number, totalMemoryGiB: number): FitBand {
  const ratio = estimatedFootprintGiB / totalMemoryGiB
  if (ratio <= COMFORTABLE_THRESHOLD) return "comfortable"
  if (ratio <= TIGHT_THRESHOLD) return "tight"
  return "risky"
}

function recommendContext(entry: ModelEntry, fitBand: FitBand, totalMemoryGiB: number): {
  value: number
  note: string
} {
  const base = entry.trainedContextLength ?? 131072
  const isMoeHighMem = entry.isMoe && totalMemoryGiB >= 32
  const maxContextTarget = isMoeHighMem
    ? 131072
    : (totalMemoryGiB > 48 ? 131072 : totalMemoryGiB >= 32 ? 65536 : 32768)

  const fitCap = fitBand === "comfortable"
    ? Math.min(base, maxContextTarget)
    : fitBand === "tight"
      ? (isMoeHighMem ? Math.min(base, maxContextTarget) : Math.min(base, 16384))
      : Math.min(base, 4096)

  const machineCap = totalMemoryGiB <= 8
    ? 4096
    : totalMemoryGiB <= 16
      ? 8192
      : totalMemoryGiB <= 32
        ? (isMoeHighMem ? 131072 : 32768)
        : totalMemoryGiB <= 48
          ? (isMoeHighMem ? 131072 : 65536)
          : 131072

  return {
    value: Math.min(fitCap, machineCap),
    note: entry.trainedContextLength
      ? `trained max: ${entry.trainedContextLength}`
      : "trained context unknown; recommended based on memory capacity"
  }
}

function confidenceFor(source: MetadataSource | undefined): RecommendationConfidence {
  if (source === "gguf_header" || source === "mlx_config") return "high"
  if (source === "file_size_only") return "low"
  return "medium"
}

const QUANT_NOTES: Record<string, string> = {
  "Q4_K_M": "4-bit balanced quant — good default for most use cases",
  "Q8_0": "8-bit quant — higher fidelity; uses more memory",
  "Q2_K": "2-bit quant — lowest memory use; quality tradeoff"
}

function buildExplanation(entry: ModelEntry, fitBand: FitBand, estimatedFootprintGiB: number, machine: MachineProfile): string {
  const clauses: string[] = []
  if (fitBand === "comfortable") {
    clauses.push(`fits comfortably — ~${estimatedFootprintGiB.toFixed(1)} GiB estimated / ${machine.totalMemoryGiB.toFixed(0)} GiB available`)
  } else if (fitBand === "tight") {
    clauses.push(`fits but with limited headroom — ~${estimatedFootprintGiB.toFixed(1)} GiB estimated / ${machine.totalMemoryGiB.toFixed(0)} GiB; constrain context`)
  } else {
    clauses.push(`tight fit — ~${estimatedFootprintGiB.toFixed(1)} GiB estimated / ${machine.totalMemoryGiB.toFixed(0)} GiB; swap risk likely`)
  }

  if (entry.quantization) clauses.push(QUANT_NOTES[entry.quantization] ?? `${entry.quantization} quant`)
  if (entry.isMoe) {
    const activeParamsVal = entry.activeParams || 0
    const paramCountVal = entry.paramCount || 0
    clauses.push(
      activeParamsVal && paramCountVal
        ? `MoE: ~${activeParamsVal}B active params per token (${paramCountVal}B stored)`
        : "MoE architecture — total params stored, fewer active per token"
    )
  }
  if (entry.metadataSource === "file_size_only") {
    clauses.push("note: metadata unavailable — estimates from file size only")
  }

  return clauses.join("; ")
}

function recommendPresetHint(entry: ModelEntry, fitBand: FitBand, recommendedContext: number): Pick<Recommendation, "presetHint" | "presetHintReason"> {
  if (fitBand === "risky") {
    return {
      presetHint: "fast",
      presetHintReason: "use a smaller starting context and lower memory pressure first"
    }
  }
  if (recommendedContext >= 32768) {
    return {
      presetHint: "long-context",
      presetHintReason: "you have enough headroom to start with a larger working context"
    }
  }
  return {
    presetHint: "balanced",
    presetHintReason: "start with the default tuning profile, then adjust only if you need more context or lower latency"
  }
}

export function buildRecommendation(entry: ModelEntry, machine: MachineProfile): Recommendation {
  // 1. Calculate provisional footprint at a baseline 4096 context length
  const provisionalFootprint = estimateFootprintGiB(entry, 4096)
  const provisionalFitBand = computeFitBand(provisionalFootprint, machine.totalMemoryGiB)

  // 2. Determine recommended context length
  const context = recommendContext(entry, provisionalFitBand, machine.totalMemoryGiB)

  // 3. Calculate final footprint at the recommended context length
  const estimatedFootprintGiB = estimateFootprintGiB(entry, context.value)
  const fitBand = computeFitBand(estimatedFootprintGiB, machine.totalMemoryGiB)

  // 4. Determine final preset hint
  const preset = recommendPresetHint(entry, fitBand, context.value)

  let explanation = buildExplanation(entry, fitBand, estimatedFootprintGiB, machine)
  if (entry.runtime === "llama.cpp" && (entry.id.toLowerCase().includes("mtp") || entry.slug.toLowerCase().includes("mtp") || entry.path.toLowerCase().includes("mtp"))) {
    explanation += "; model appears to support Multi-Token Prediction (MTP) — we recommend setting spec-type=draft-mtp and spec-draft-ngl=999"
  }

  return {
    fitBand,
    estimatedFootprintGiB,
    recommendedContext: context.value,
    recommendedContextNote: context.note,
    confidence: confidenceFor(entry.metadataSource),
    explanation,
    ...preset
  }
}

