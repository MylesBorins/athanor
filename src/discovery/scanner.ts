import * as fs from "fs"
import * as path from "path"
import type { DiscoveredModel, MlxCapability, RuntimeType } from "../types/index.js"
import { getModelDirs } from "../config/index.js"

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
    return hasConfig && hasSafetensors && !hasGguf
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

function snapshotSizeBytes(snapshotDir: string): number {
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

function parseHfCacheDir(dirName: string): { org: string; repo: string } | null {
  // models--<org>--<repo-with-dashes-preserved>
  if (!dirName.startsWith("models--")) return null
  const rest = dirName.slice("models--".length)
  const firstSep = rest.indexOf("--")
  if (firstSep < 0) return null
  const org = rest.slice(0, firstSep)
  const repo = rest.slice(firstSep + 2)
  if (!org || !repo) return null
  return { org, repo }
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
      models.push({
        id: repo,
        name: parsed.repo,
        path: snapshotDir,
        runtime: "mlx",
        source: { type: "hf", repo },
        sizeBytes: snapshotSizeBytes(snapshotDir),
        mlxCapabilities: detectMlxCapabilities(snapshotDir)
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
            sizeBytes: stats.size
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
            sizeBytes
          })
        }
      } catch { /* unreadable snapshot, skip */ }
    }
  } catch (err) {
    console.error(`Error scanning HF cache for GGUF models: ${err}`)
  }

  return models
}

export function scanModels(): Model[] {
  const dirs = getModelDirs()

  const mlxModels      = scanMlxModels(dirs.mlx)
  const ggufModels     = scanGgufModels(dirs.llama)
  const hfGgufModels   = scanHFCacheGgufModels(dirs.mlx)  // reuses HF hub cache dir

  return [...mlxModels, ...ggufModels, ...hfGgufModels]
}

export function getModelByPath(modelPath: string): Model | undefined {
  const models = scanModels()
  return models.find(m => m.path === modelPath)
}

export function getRuntimeForModel(model: Model): RuntimeType {
  return model.runtime
}

export type { DiscoveredModel, RuntimeType } from "../types/index.js"
