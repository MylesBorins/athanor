import * as path from "path"
import type { DiscoveredModel, ModelEntry, RuntimeType, ModelCapability } from "../types/index.js"
import { detectGgufMtp } from "../discovery/scanner.js"
import {
  allocatePort,
  loadRegistry,
  normalizeModelPath,
  saveRegistry,
  slugify,
  snapshot,
  uniqueSlug
} from "./index.js"

export interface RegistryMaterializeResult {
  entry: ModelEntry
  created: boolean
  changed: boolean
}

export interface RegistryMaterializeInput {
  id: string
  name: string
  path: string
  runtime: RuntimeType
  source: ModelEntry["source"]
  sizeBytes?: number
  mlxCapabilities?: ModelEntry["mlxCapabilities"]
  capabilities?: ModelEntry["capabilities"]
  architectureFamily?: ModelEntry["architectureFamily"]
  trainedContextLength?: ModelEntry["trainedContextLength"]
  quantization?: ModelEntry["quantization"]
  paramCount?: ModelEntry["paramCount"]
  isMoe?: ModelEntry["isMoe"]
  activeParams?: ModelEntry["activeParams"]
  metadataSource?: ModelEntry["metadataSource"]
}

export function discoveredToMaterializeInput(d: DiscoveredModel): RegistryMaterializeInput {
  return {
    id: d.id,
    name: d.name,
    path: d.path,
    runtime: d.runtime,
    source: d.source,
    sizeBytes: d.sizeBytes,
    mlxCapabilities: d.runtime === "mlx" ? d.mlxCapabilities : undefined,
    capabilities: d.capabilities,
    architectureFamily: d.architectureFamily,
    trainedContextLength: d.trainedContextLength,
    quantization: d.quantization,
    paramCount: d.paramCount,
    isMoe: d.isMoe,
    activeParams: d.activeParams,
    metadataSource: d.metadataSource
  }
}

function sourceAwareName(
  runtime: RuntimeType,
  source: ModelEntry["source"],
  fallbackName: string
): string {
  if (runtime !== "llama.cpp") return fallbackName
  if (source.type !== "hf") return fallbackName
  const repoTail = source.repo.split("/").pop() ?? source.repo
  if (!source.file) return repoTail
  const fileBase = path.basename(source.file, ".gguf")
  return `${repoTail}-${fileBase}`
}

export function pullToMaterializeInput(
  repo: string,
  file: string | undefined,
  revision: string | undefined,
  runtime: RuntimeType,
  resolvedPath: string,
  mlxCapabilities?: ModelEntry["mlxCapabilities"]
): RegistryMaterializeInput {
  const source: ModelEntry["source"] = { type: "hf", repo, revision, file }
  return {
    id: file ? `${repo}:${file}` : repo,
    name: sourceAwareName(runtime, source, file ? path.basename(file, ".gguf") : repo),
    path: resolvedPath,
    runtime,
    source,
    mlxCapabilities: runtime === "mlx" ? mlxCapabilities : undefined,
    capabilities: runtime === "mlx"
      ? (mlxCapabilities && mlxCapabilities.includes("vlm") ? ["vlm"] : [])
      : (detectGgufMtp(resolvedPath) ? ["mtp"] : [])
  }
}

// Shared entry materialization policy for both discovery ingest and
// explicit pull. This is the single place that decides which fields
// are refreshed from the filesystem/network (`path`, `sizeBytes`,
// detected `mlxCapabilities`) versus which fields are user-owned and
// therefore preserved (`slug`, `port`, `publish`, `piAlias`, `preset`,
// `tags`, `mlxFlavor`). Keep this aligned with the non-destructive
// scan invariant from AGENTS.md.
export function materializeRegistryEntry(input: RegistryMaterializeInput): RegistryMaterializeResult {
  const reg = loadRegistry()
  const snap = snapshot(reg)
  let existing = reg.models.find(m => m.id === input.id)

  // Deduplicate by path: pull and scan can produce different IDs for
  // the same on-disk file (e.g. pull uses "repo:file" while
  // scanGgufModels for the llama dir uses the full path). When we
  // find a path collision, merge into the existing entry rather than
  // creating a duplicate registry row.
  let upgradedSource = false
  const normalizedInputPath = normalizeModelPath(input.path)
  if (!existing) {
    existing = reg.models.find(m => normalizeModelPath(m.path) === normalizedInputPath)
    if (existing) {
      // Upgrade the source and id if the new input carries richer
      // metadata (e.g. a scan-local entry gets an HF source from pull).
      if (existing.source.type === "local" && input.source.type === "hf") {
        existing.id = input.id
        existing.source = input.source
        upgradedSource = true
      }
    }
  }

  if (existing) {
    const changed = updateExistingEntry(existing, input) || upgradedSource
    if (changed) saveRegistry(reg)
    return { entry: existing, created: false, changed }
  }

  const desiredSlug = slugify(sourceAwareName(input.runtime, input.source, input.name))
  const slug = uniqueSlug(desiredSlug, snap.slugs)
  const port = allocatePort(snap.ports)
  const entry: ModelEntry = {
    id: input.id,
    slug,
    path: input.path,
    runtime: input.runtime,
    source: input.source,
    port,
    publish: true,
    piAlias: slug,
    sizeBytes: input.sizeBytes,
    addedAt: Date.now(),
    ...(input.runtime === "mlx" && input.mlxCapabilities && input.mlxCapabilities.length > 0
      ? { mlxCapabilities: input.mlxCapabilities }
      : {}),
    ...(input.capabilities && input.capabilities.length > 0
      ? { capabilities: input.capabilities }
      : {}),
    ...(input.architectureFamily ? { architectureFamily: input.architectureFamily } : {}),
    ...(input.trainedContextLength ? { trainedContextLength: input.trainedContextLength } : {}),
    ...(input.quantization ? { quantization: input.quantization } : {}),
    ...(input.paramCount ? { paramCount: input.paramCount } : {}),
    ...(input.isMoe ? { isMoe: input.isMoe } : {}),
    ...(input.activeParams ? { activeParams: input.activeParams } : {}),
    ...(input.metadataSource ? { metadataSource: input.metadataSource } : {})
  }
  reg.models.push(entry)
  saveRegistry(reg)
  return { entry, created: true, changed: true }
}

// Update only materialized facts about an existing model. Never touch
// user intent fields here; callers rely on re-scan and re-pull being
// additive/non-destructive.
function updateExistingEntry(existing: ModelEntry, input: RegistryMaterializeInput): boolean {
  let changed = false

  if (existing.path !== input.path) {
    existing.path = input.path
    changed = true
  }

  if (input.sizeBytes !== undefined && existing.sizeBytes !== input.sizeBytes) {
    existing.sizeBytes = input.sizeBytes
    changed = true
  }

  if (input.runtime === "mlx") {
    const nextCaps = input.mlxCapabilities ?? []
    const prevCaps = existing.mlxCapabilities ?? []
    if (!capsEqual(prevCaps, nextCaps)) {
      if (nextCaps.length > 0) existing.mlxCapabilities = nextCaps
      else delete existing.mlxCapabilities
      changed = true
    }
  }

  const nextGeneralCaps = input.capabilities ?? []
  const prevGeneralCaps = existing.capabilities ?? []
  if (!capsEqual(prevGeneralCaps, nextGeneralCaps)) {
    if (nextGeneralCaps.length > 0) existing.capabilities = nextGeneralCaps
    else delete existing.capabilities
    changed = true
  }

  changed = replaceDetectedField(existing, "architectureFamily", input.architectureFamily) || changed
  changed = replaceDetectedField(existing, "trainedContextLength", input.trainedContextLength) || changed
  changed = replaceDetectedField(existing, "quantization", input.quantization) || changed
  changed = replaceDetectedField(existing, "paramCount", input.paramCount) || changed
  changed = replaceDetectedField(existing, "isMoe", input.isMoe) || changed
  changed = replaceDetectedField(existing, "activeParams", input.activeParams) || changed
  changed = replaceDetectedField(existing, "metadataSource", input.metadataSource) || changed

  if (existing.metadataSource === "file_size_only") {
    changed = replaceDetectedField(existing, "architectureFamily", input.architectureFamily) || changed
    changed = replaceDetectedField(existing, "trainedContextLength", input.trainedContextLength) || changed
    changed = replaceDetectedField(existing, "quantization", input.quantization) || changed
    changed = replaceDetectedField(existing, "paramCount", input.paramCount) || changed
    changed = replaceDetectedField(existing, "isMoe", input.isMoe) || changed
    changed = replaceDetectedField(existing, "activeParams", input.activeParams) || changed
  }

  if (input.metadataSource === "file_size_only") {
    changed = clearDetectedField(existing, "architectureFamily") || changed
    changed = clearDetectedField(existing, "trainedContextLength") || changed
    changed = clearDetectedField(existing, "quantization") || changed
    changed = clearDetectedField(existing, "paramCount") || changed
    changed = clearDetectedField(existing, "isMoe") || changed
    changed = clearDetectedField(existing, "activeParams") || changed
  }

  return changed
}

function replaceDetectedField<K extends keyof Pick<ModelEntry,
  "architectureFamily" |
  "trainedContextLength" |
  "quantization" |
  "paramCount" |
  "isMoe" |
  "activeParams" |
  "metadataSource"
>>(
  entry: ModelEntry,
  key: K,
  value: ModelEntry[K] | undefined
): boolean {
  if (value === undefined) {
    if (entry[key] === undefined) return false
    delete entry[key]
    return true
  }
  if (entry[key] === value) return false
  entry[key] = value
  return true
}

function clearDetectedField<K extends keyof Pick<ModelEntry,
  "architectureFamily" |
  "trainedContextLength" |
  "quantization" |
  "paramCount" |
  "isMoe" |
  "activeParams"
>>(
  entry: ModelEntry,
  key: K
): boolean {
  if (entry[key] === undefined) return false
  delete entry[key]
  return true
}

function capsEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  const sa = [...a].sort()
  const sb = [...b].sort()
  return sa.every((v, i) => v === sb[i])
}
