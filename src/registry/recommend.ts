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
  presetHint?: "fast" | "balanced" | "coding"
  presetHintReason?: string
}

const COMFORTABLE_THRESHOLD = 0.60
const TIGHT_THRESHOLD = 0.75

function estimateFootprintGiB(sizeBytes: number | undefined): number {
  const weightGiB = (sizeBytes ?? 0) / (1024 ** 3)
  return weightGiB * 1.1 + 0.5
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
  const base = entry.trainedContextLength ?? 4096
  const fitCap = fitBand === "comfortable"
    ? Math.min(base, 16384)
    : fitBand === "tight"
      ? Math.min(base, 8192)
      : Math.min(base, 4096)

  const machineCap = totalMemoryGiB <= 8
    ? 4096
    : totalMemoryGiB <= 16
      ? 8192
      : totalMemoryGiB <= 32
        ? 16384
        : 32768

  return {
    value: Math.min(fitCap, machineCap),
    note: entry.trainedContextLength
      ? `trained max: ${entry.trainedContextLength}`
      : "trained context unknown; using conservative default"
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
    clauses.push(
      entry.activeParams && entry.paramCount
        ? `MoE: ~${entry.activeParams}B active params per token (${entry.paramCount}B stored)`
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
  if (recommendedContext >= 16384) {
    return {
      presetHint: entry.runtime === "llama.cpp" ? "coding" : "coding",
      presetHintReason: "you have enough headroom to start with a larger working context"
    }
  }
  return {
    presetHint: "balanced",
    presetHintReason: "start with the default tuning profile, then adjust only if you need more context or lower latency"
  }
}

export function buildRecommendation(entry: ModelEntry, machine: MachineProfile): Recommendation {
  const estimatedFootprintGiB = estimateFootprintGiB(entry.sizeBytes)
  const fitBand = computeFitBand(estimatedFootprintGiB, machine.totalMemoryGiB)
  const context = recommendContext(entry, fitBand, machine.totalMemoryGiB)
  const preset = recommendPresetHint(entry, fitBand, context.value)
  return {
    fitBand,
    estimatedFootprintGiB,
    recommendedContext: context.value,
    recommendedContextNote: context.note,
    confidence: confidenceFor(entry.metadataSource),
    explanation: buildExplanation(entry, fitBand, estimatedFootprintGiB, machine),
    ...preset
  }
}
