import type { MachineProfile } from "../machine/profile.js"
import type { MetadataSource, ModelEntry, RuntimeType } from "../types/index.js"
import { buildRecommendation, type Recommendation } from "../registry/recommend.js"
import type { SearchResult, SearchSelectionHint } from "./hf.js"

export interface SearchRecommendation extends Recommendation {
  runnable: boolean
  runtimeLabel: RuntimeType | "source"
}

function inferQuantization(result: SearchResult): string | undefined {
  const id = result.id.toUpperCase()
  if (id.includes("Q4_K_M")) return "Q4_K_M"
  if (id.includes("Q8_0")) return "Q8_0"
  const m = result.id.match(/\b(Q\d(?:_[A-Z])?(?:_[A-Z])?)\b/i)
  return m?.[1]?.toUpperCase()
}

function inferMetadataSource(result: SearchResult): MetadataSource | undefined {
  if (result.sourceFallback === "exact-repo") return "file_size_only"
  if (result.runtime === "llama.cpp") return result.sizeBytes !== undefined ? "gguf_header" : undefined
  if (result.runtime === "mlx") return result.sizeBytes !== undefined ? "mlx_config" : undefined
  return undefined
}

function toPseudoEntry(result: SearchResult, hint?: SearchSelectionHint): ModelEntry | null {
  const runtime = result.runtime
  if (!runtime) return null
  const sizeBytes = runtime === "llama.cpp"
    ? (hint?.defaultFileSizeBytes ?? hint?.ggufTotalSizeBytes ?? result.sizeBytes)
    : (hint?.ggufTotalSizeBytes ?? result.sizeBytes)
  if (sizeBytes === undefined) return null

  return {
    id: result.id,
    slug: result.id.split("/").pop() ?? result.id,
    path: result.id,
    runtime,
    source: { type: "hf", repo: result.id },
    port: 0,
    publish: false,
    addedAt: 0,
    sizeBytes,
    quantization: inferQuantization(result),
    trainedContextLength: hint?.ggufContextLength,
    metadataSource: inferMetadataSource(result)
  }
}

export function buildSearchRecommendation(
  result: SearchResult,
  machine: MachineProfile,
  hint?: SearchSelectionHint
): SearchRecommendation | null {
  const entry = toPseudoEntry(result, hint)
  if (!entry) return null
  const rec = buildRecommendation(entry, machine)
  return {
    ...rec,
    runnable: Boolean(result.runtime),
    runtimeLabel: result.runtime ?? "source"
  }
}

function fitRank(rec: SearchRecommendation | null): number {
  if (!rec) return 0
  if (rec.fitBand === "comfortable") return 3
  if (rec.fitBand === "tight") return 2
  return 1
}

export function sortByFit(
  results: SearchResult[],
  machine: MachineProfile,
  hints: Record<string, SearchSelectionHint> = {}
): SearchResult[] {
  return [...results].sort((a, b) => {
    const ar = buildSearchRecommendation(a, machine, hints[a.id])
    const br = buildSearchRecommendation(b, machine, hints[b.id])
    const fit = fitRank(br) - fitRank(ar)
    if (fit !== 0) return fit
    const conf = (br?.confidence === "high" ? 3 : br?.confidence === "medium" ? 2 : br?.confidence === "low" ? 1 : 0)
      - (ar?.confidence === "high" ? 3 : ar?.confidence === "medium" ? 2 : ar?.confidence === "low" ? 1 : 0)
    if (conf !== 0) return conf
    const size = (a.sizeBytes ?? Number.POSITIVE_INFINITY) - (b.sizeBytes ?? Number.POSITIVE_INFINITY)
    if (size !== 0) return size
    return (b.downloads ?? -1) - (a.downloads ?? -1)
  })
}
