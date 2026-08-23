import * as fs from "fs"
import * as path from "path"
import type { DiscoveredModel, MlxCapability, ModelSource, RuntimeType, ModelCapability, ReasoningEffortCapability } from "../types/index.js"
import { getModelDirs } from "../config/index.js"
import { normalizeModelPath } from "../registry/index.js"

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v)
}

export function detectArchitectureFamily(modelType: string | undefined, fallbackName: string): string | undefined {
  const value = (modelType ?? fallbackName).toLowerCase()
  if (value.includes("qwen")) return "qwen"
  if (value.includes("llama")) return "llama"
  if (value.includes("gemma")) return "gemma"
  if (value.includes("mistral")) return "mistral"
  if (value.includes("phi")) return "phi"
  return undefined
}

// Known VLM model_types. HF's transformers registry is the source of
// truth; we only list the ones mlx_vlm.server supports today. The
// more reliable signal is the presence of `vision_config` in
// config.json (virtually all VLMs have one) — this list is a fallback
// for configs that omit it.
// Unambiguously-VLM model_types only. Types that also denote
// text-only variants of the same family (e.g. "gemma3", where both
// text and multimodal releases exist) are excluded: the
// `vision_config` check above already catches the multimodal case,
// and excluding them from this list prevents text-only releases
// from being mis-routed to mlx_vlm.server.
const VLM_MODEL_TYPES = new Set<string>([
  "qwen2_vl", "qwen2_5_vl",
  "llava", "llava_next", "llava_next_video", "llava_onevision",
  "mllama",
  "pixtral",
  "idefics2", "idefics3",
  "phi3_v"
])

type Model = DiscoveredModel

/**
 * The HuggingFace hub cache layout is:
 *   models--<org>--<repo>/
 *     refs/main          ← contains the current revision hash
 *     snapshots/
 *       <hash>/          ← actual model files (often symlinks into blobs/)
 *
 * We resolve the snapshot dir and use it as the model path, which is what
 * mlx_lm.server --model expects.
 */
function resolveSnapshotDir(modelDir: string): string | null {
  // Prefer the ref pointed to by refs/main
  const refsMain = path.join(modelDir, "refs", "main")
  if (fs.existsSync(refsMain)) {
    const hash = fs.readFileSync(refsMain, "utf8").trim()
    const candidate = path.join(modelDir, "snapshots", hash)
    if (fs.existsSync(candidate)) return candidate
  }

  // Fall back to the most-recently-modified snapshot directory
  const snapshotsDir = path.join(modelDir, "snapshots")
  if (!fs.existsSync(snapshotsDir)) return null

  const entries = fs.readdirSync(snapshotsDir, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => {
      const p = path.join(snapshotsDir, e.name)
      return { p, mtime: fs.statSync(p).mtimeMs }
    })
    .sort((a, b) => b.mtime - a.mtime)

  return entries[0]?.p ?? null
}

function isMlxSnapshot(snapshotDir: string): boolean {
  try {
    const files = fs.readdirSync(snapshotDir)
    const hasConfig = files.includes("config.json")
    const hasSafetensors = files.some(f => f.endsWith(".safetensors"))
    const hasGguf = files.some(f => f.endsWith(".gguf"))
    const hasMlxMarker = files.includes("quantization_config.json") || /\bmlx\b/i.test(snapshotDir)
    return hasConfig && hasSafetensors && !hasGguf && hasMlxMarker
  } catch {
    return false
  }
}

// Best-effort detection of MLX capabilities advertised by config.json.
// Today the only capability is "vlm" — set when config advertises a
// vision component (either a nested `vision_config`, a known VLM
// `model_type`, or a vision marker in `architectures[]`). Returns []
// when config is unreadable or the model is text-only. Capability is a
// detected fact; the routing decision (mlx_lm vs mlx_vlm) is stored
// separately as `mlxFlavor` and only set by the user.
export function detectMlxCapabilities(snapshotDir: string): MlxCapability[] {
  try {
    const raw = fs.readFileSync(path.join(snapshotDir, "config.json"), "utf8")
    const cfg = JSON.parse(raw) as Record<string, unknown>
    if (cfg && typeof cfg === "object" && "vision_config" in cfg) return ["vlm"]
    const modelType = typeof cfg.model_type === "string" ? cfg.model_type : ""
    if (VLM_MODEL_TYPES.has(modelType)) return ["vlm"]
    const arches = Array.isArray(cfg.architectures) ? cfg.architectures : []
    // Architecture class names are CamelCase with no word boundaries
    // between runs (e.g. Qwen2VLForConditionalGeneration), so match
    // known vision markers case-insensitively.
    const archRx = /vision|vlfor|vlmodel|vlforcausallm|onevision/i
    for (const a of arches) {
      if (typeof a === "string" && archRx.test(a)) return ["vlm"]
    }
    return []
  } catch {
    return []
  }
}

export function detectMlxMetadata(snapshotDir: string, fallbackName?: string): Pick<DiscoveredModel,
  "architectureFamily" |
  "trainedContextLength" |
  "quantization" |
  "paramCount" |
  "isMoe" |
  "activeParams" |
  "metadataSource"
> {
  try {
    const raw = fs.readFileSync(path.join(snapshotDir, "config.json"), "utf8")
    const cfg = JSON.parse(raw) as Record<string, unknown>
    const modelType = typeof cfg.model_type === "string" ? cfg.model_type : undefined
    const maxPos = typeof cfg.max_position_embeddings === "number" ? cfg.max_position_embeddings : undefined
    const numExperts = typeof cfg.num_experts === "number" ? cfg.num_experts : undefined
    const numExpertsPerTok = typeof cfg.num_experts_per_tok === "number" ? cfg.num_experts_per_tok : undefined
    let quantization: string | undefined
    try {
      const qraw = fs.readFileSync(path.join(snapshotDir, "quantization_config.json"), "utf8")
      const qcfg = JSON.parse(qraw) as unknown
      if (isRecord(qcfg) && typeof qcfg.group_size === "number" && typeof qcfg.bits === "number") {
        quantization = `${qcfg.bits}-bit`
      }
    } catch { /* optional */ }
    return {
      architectureFamily: detectArchitectureFamily(modelType, fallbackName ?? path.basename(snapshotDir)),
      trainedContextLength: maxPos,
      quantization,
      isMoe: (numExperts ?? 0) > 1,
      activeParams: numExpertsPerTok,
      metadataSource: "mlx_config"
    }
  } catch {
    return { metadataSource: "file_size_only" }
  }
}

export function detectGgufMtp(filePath: string): boolean {
  let fd: number | null = null
  try {
    fd = fs.openSync(filePath, "r")
    const smallBuffer = Buffer.alloc(64 * 1024)
    const read1 = fs.readSync(fd, smallBuffer, 0, smallBuffer.length, 0)
    const smallStr = smallBuffer.toString("binary", 0, read1)
    if (smallStr.includes("nextn_predict_layers") || smallStr.includes("mtp_attn") || smallStr.includes("output_mtp")) {
      return true
    }

    const largeBuffer = Buffer.alloc(8 * 1024 * 1024)
    const read2 = fs.readSync(fd, largeBuffer, 0, largeBuffer.length, 0)
    const largeStr = largeBuffer.toString("binary", 0, read2)
    if (largeStr.includes("mtp_attn") || largeStr.includes("output_mtp") || largeStr.includes("mtp.weight")) {
      return true
    }
  } catch {
    // ignore
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd)
      } catch {}
    }
  }
  return false
}

export function extractReasoningEffortFromTemplate(templateStr: string): ReasoningEffortCapability | undefined {
  if (!templateStr.includes("reasoning_effort")) return undefined

  // Match enum list like: reasoning_effort not in ['xhigh', 'medium', 'low'] or in ['xhigh', 'medium', 'low']
  const listMatch = templateStr.match(/reasoning_effort\s*(?:not\s+in|in)\s*\[([^\]]+)\]/i)
  let enumValues: string[] = []

  if (listMatch && listMatch[1]) {
    enumValues = Array.from(listMatch[1].matchAll(/['"]([a-zA-Z0-9_-]+)['"]/g)).map(m => m[1]!)
  } else {
    // Collect equality checks like: reasoning_effort == 'xhigh'
    const eqMatches = Array.from(templateStr.matchAll(/reasoning_effort\s*==\s*['"]([a-zA-Z0-9_-]+)['"]/g)).map(m => m[1]!)
    if (eqMatches.length > 0) {
      enumValues = Array.from(new Set(eqMatches))
    }
  }

  if (enumValues.length === 0) {
    // If reasoning_effort is referenced without an explicit list, use standard fallback
    enumValues = ["xhigh", "medium", "low"]
  }

  // Extract template default: reasoning_effort | default('xhigh') or reasoning_effort = 'xhigh'
  const defMatch = templateStr.match(/reasoning_effort\s*\|\s*default\(\s*['"]([^'"]+)['"]\s*\)/i)
    || templateStr.match(/set\s+reasoning_effort\s*=\s*['"]([^'"]+)['"]/i)
  const templateDefault = defMatch ? defMatch[1]! : (enumValues[0] || "xhigh")

  // Determine opinionated safe default: if template defaults to xhigh, recommend medium
  let athanorDefault = templateDefault
  if (templateDefault === "xhigh" && enumValues.includes("medium")) {
    athanorDefault = "medium"
  } else if (!enumValues.includes(athanorDefault)) {
    athanorDefault = enumValues.includes("medium") ? "medium" : enumValues[0]!
  }

  return {
    enum: enumValues,
    templateDefault,
    athanorDefault
  }
}

export function detectReasoningEffort(filePath: string, fallbackName?: string): ReasoningEffortCapability | undefined {
  // 1. Check if filePath is a GGUF file and scan its header for chat_template / reasoning_effort
  if (filePath.endsWith(".gguf") && fs.existsSync(filePath)) {
    let fd: number | null = null
    try {
      fd = fs.openSync(filePath, "r")
      const buffer = Buffer.alloc(1024 * 1024) // 1MB header read
      const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0)
      const headerStr = buffer.toString("utf8", 0, bytesRead)
      if (headerStr.includes("reasoning_effort")) {
        const fromTemplate = extractReasoningEffortFromTemplate(headerStr)
        if (fromTemplate) return fromTemplate
      }
    } catch {
      // ignore
    } finally {
      if (fd !== null) {
        try { fs.closeSync(fd) } catch {}
      }
    }
  }

  // 2. Check if a tokenizer_config.json exists in directory
  try {
    const configPath = fs.statSync(filePath).isDirectory()
      ? path.join(filePath, "tokenizer_config.json")
      : path.join(path.dirname(filePath), "tokenizer_config.json")
    if (fs.existsSync(configPath)) {
      const data = JSON.parse(fs.readFileSync(configPath, "utf8")) as Record<string, unknown>
      const chatTemplate = typeof data.chat_template === "string" ? data.chat_template : ""
      if (chatTemplate.includes("reasoning_effort")) {
        const fromTemplate = extractReasoningEffortFromTemplate(chatTemplate)
        if (fromTemplate) return fromTemplate
      }
    }
  } catch {
    // ignore
  }

  // 3. Fallback: Known model pattern check (e.g. Qwen3.8)
  const nameToCheck = `${filePath} ${fallbackName ?? ""}`.toLowerCase()
  if (/qwen[-_]?3\.?8/i.test(nameToCheck)) {
    return {
      enum: ["xhigh", "medium", "low"],
      templateDefault: "xhigh",
      athanorDefault: "medium"
    }
  }

  return undefined
}

export function detectGgufMetadata(filePath: string, fallbackName?: string): Pick<DiscoveredModel,
  "architectureFamily" |
  "quantization" |
  "capabilities" |
  "reasoningEffort" |
  "metadataSource"
> {
  const name = path.basename(filePath, ".gguf")
  const upper = name.toUpperCase()
  const known = ["Q8_0", "Q6_K", "Q5_K_M", "Q4_K_M", "Q4_0", "Q3_K_M", "Q2_K"]
  const quantization = known.find(q => upper.includes(q))
  const capabilities: ModelCapability[] = []
  if (detectGgufMtp(filePath)) {
    capabilities.push("mtp")
  }
  const reasoningEffort = detectReasoningEffort(filePath, fallbackName ?? name)
  if (reasoningEffort) {
    capabilities.push("reasoning_effort")
  }
  return {
    architectureFamily: detectArchitectureFamily(undefined, fallbackName ?? name),
    quantization,
    capabilities,
    reasoningEffort,
    metadataSource: quantization ? "gguf_header" : "file_size_only"
  }
}

export function snapshotSizeBytes(snapshotDir: string): number {
  try {
    return fs.readdirSync(snapshotDir).reduce((sum, name) => {
      try {
        // statSync follows symlinks, giving the real blob size
        return sum + fs.statSync(path.join(snapshotDir, name)).size
      } catch {
        return sum
      }
    }, 0)
  } catch {
    return 0
  }
}

/** org--repo dir names from athanor pull (`author/repo` → `author--repo`). */
export function parseOrgRepoDir(dirName: string): { org: string; repo: string } | null {
  const firstSep = dirName.indexOf("--")
  if (firstSep < 0) return null
  const org = dirName.slice(0, firstSep)
  const repo = dirName.slice(firstSep + 2)
  if (!org || !repo) return null
  return { org, repo }
}

function parseHfCacheDir(dirName: string): { org: string; repo: string } | null {
  // models--<org>--<repo-with-dashes-preserved>
  if (!dirName.startsWith("models--")) return null
  return parseOrgRepoDir(dirName.slice("models--".length))
}

function scanMlxModels(baseDir: string): Model[] {
  const models: Model[] = []
  if (!fs.existsSync(baseDir)) return models

  try {
    const entries = fs.readdirSync(baseDir, { withFileTypes: true })

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const parsed = parseHfCacheDir(entry.name)
      if (!parsed) continue

      const modelDir = path.join(baseDir, entry.name)
      const snapshotDir = resolveSnapshotDir(modelDir)
      if (!snapshotDir || !isMlxSnapshot(snapshotDir)) continue

      const repo = `${parsed.org}/${parsed.repo}`
      const metadata = detectMlxMetadata(snapshotDir, parsed.repo)
      const mlxCaps = detectMlxCapabilities(snapshotDir)
      const capabilities: ModelCapability[] = []
      if (mlxCaps.includes("vlm")) {
        capabilities.push("vlm")
      }
      const reasoningEffort = detectReasoningEffort(snapshotDir, parsed.repo)
      if (reasoningEffort) {
        capabilities.push("reasoning_effort")
      }
      models.push({
        id: repo,
        name: parsed.repo,
        path: snapshotDir,
        runtime: "mlx",
        source: { type: "hf", repo },
        sizeBytes: snapshotSizeBytes(snapshotDir),
        mlxCapabilities: mlxCaps,
        capabilities,
        reasoningEffort,
        ...metadata
      })
    }
  } catch (err) {
    console.error(`Error scanning MLX models: ${err}`)
  }

  return models
}

function scanGgufModels(baseDir: string): Model[] {
  const models: Model[] = []

  if (!fs.existsSync(baseDir)) {
    return models
  }

  function scanDir(dir: string): void {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name)
        
        if (entry.isDirectory()) {
          scanDir(fullPath)
        } else if (entry.name.endsWith(".gguf")) {
          const stats = fs.statSync(fullPath)
          const name = path.basename(entry.name, ".gguf")
          models.push({
            id: fullPath,
            name,
            path: fullPath,
            runtime: "llama.cpp",
            source: { type: "local" },
            sizeBytes: stats.size,
            ...detectGgufMetadata(fullPath, name)
          })
        }
      }
    } catch (err) {
      console.error(`Error scanning directory ${dir}: ${err}`)
    }
  }

  scanDir(baseDir)
  return models
}

/**
 * Scan the HuggingFace hub cache for GGUF models from non-mlx-community orgs.
 * Handles the same models--<org>--<repo>/snapshots/<hash>/ layout as the MLX scanner
 * but looks for .gguf files instead of safetensors.
 */
function scanHFCacheGgufModels(hubDir: string): Model[] {
  const models: Model[] = []
  if (!fs.existsSync(hubDir)) return models

  try {
    const entries = fs.readdirSync(hubDir, { withFileTypes: true })

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const parsed = parseHfCacheDir(entry.name)
      if (!parsed) continue

      const modelDir = path.join(hubDir, entry.name)
      const snapshotDir = resolveSnapshotDir(modelDir)
      if (!snapshotDir) continue

      try {
        const files = fs.readdirSync(snapshotDir)
        for (const file of files) {
          if (!file.endsWith(".gguf")) continue

          const filePath = path.join(snapshotDir, file)
          const name = path.basename(file, ".gguf")
          const hfRepo = `${parsed.org}/${parsed.repo}`

          let sizeBytes = 0
          try { sizeBytes = fs.statSync(filePath).size } catch { /* symlink/perm issue */ }

          models.push({
            id: `${hfRepo}:${file}`,
            name,
            path: filePath,
            runtime: "llama.cpp",
            source: { type: "hf", repo: hfRepo, file },
            sizeBytes,
            ...detectGgufMetadata(filePath, name)
          })
        }
      } catch { /* unreadable snapshot, skip */ }
    }
  } catch (err) {
    console.error(`Error scanning HF cache for GGUF models: ${err}`)
  }

  return models
}

function sourceRank(source: ModelSource): number {
  return source.type === "hf" ? 1 : 0
}

export function deduplicateByPath(models: DiscoveredModel[]): DiscoveredModel[] {
  const byPath = new Map<string, DiscoveredModel>()
  for (const model of models) {
    const key = normalizeModelPath(model.path)
    const existing = byPath.get(key)
    if (!existing) {
      byPath.set(key, model)
      continue
    }
    const keep = sourceRank(model.source) > sourceRank(existing.source) ? model : existing
    byPath.set(key, keep)
  }
  return [...byPath.values()]
}

export function scanModels(): Model[] {
  const dirs = getModelDirs()

  const mlxModels      = scanMlxModels(dirs.mlx)
  const ggufModels     = scanGgufModels(dirs.llama)
  const hfGgufModels   = scanHFCacheGgufModels(dirs.mlx)  // reuses HF hub cache dir

  return deduplicateByPath([...mlxModels, ...ggufModels, ...hfGgufModels])
}

export function getModelByPath(modelPath: string): Model | undefined {
  const models = scanModels()
  return models.find(m => m.path === modelPath)
}

export function getRuntimeForModel(model: Model): RuntimeType {
  return model.runtime
}

export type { DiscoveredModel, RuntimeType } from "../types/index.js"
