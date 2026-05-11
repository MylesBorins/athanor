import type {
  LlamaConfig,
  MlxConfig,
  ModelEntry,
  RuntimePreset,
  RuntimeType
} from "../types/index.js"

// Preset key schema. Each key has a runtime, a canonical JSON name,
// one or more accepted CLI aliases (kebab-case), and a numeric value
// (all current fields are numeric; expand if/when non-numeric fields
// are added).
interface KeySpec {
  runtime: RuntimeType
  jsonName: keyof MlxConfig | keyof LlamaConfig
  aliases: string[]
  parse: (raw: string) => number
  help: string
}

function num(raw: string): number {
  const n = Number(raw)
  if (!Number.isFinite(n)) throw new Error(`expected a number, got "${raw}"`)
  return n
}

const KEYS: KeySpec[] = [
  { runtime: "mlx", jsonName: "prefillStepSize",
    aliases: ["prefillStepSize", "prefill-step-size"],
    parse: num, help: "mlx: prefill step size" },
  { runtime: "mlx", jsonName: "promptCacheSize",
    aliases: ["promptCacheSize", "prompt-cache-size"],
    parse: num, help: "mlx: prompt cache size (tokens)" },
  { runtime: "mlx", jsonName: "contextWindow",
    aliases: ["contextWindow", "context-window"],
    parse: num, help: "mlx: context window (tokens)" },
  { runtime: "mlx", jsonName: "decodeConcurrency",
    aliases: ["decodeConcurrency", "decode-concurrency"],
    parse: num, help: "mlx: parallel decode slots" },
  { runtime: "mlx", jsonName: "promptCacheBytes",
    aliases: ["promptCacheBytes", "prompt-cache-bytes"],
    parse: num, help: "mlx: prompt cache memory cap (bytes). Prefer config parsing for gb/mb units" },

  { runtime: "llama.cpp", jsonName: "nGpuLayers",
    aliases: ["nGpuLayers", "n-gpu-layers", "ngl"],
    parse: num, help: "llama: layers offloaded to GPU (999 = all)" },
  { runtime: "llama.cpp", jsonName: "threads",
    aliases: ["threads", "n-threads"],
    parse: num, help: "llama: CPU threads" },
  { runtime: "llama.cpp", jsonName: "ctxSize",
    aliases: ["ctxSize", "ctx-size", "n-ctx"],
    parse: num, help: "llama: context window (tokens)" },
  { runtime: "llama.cpp", jsonName: "batchSize",
    aliases: ["batchSize", "batch-size"],
    parse: num, help: "llama: prompt batch size" },
  { runtime: "llama.cpp", jsonName: "ubatchSize",
    aliases: ["ubatchSize", "ubatch-size"],
    parse: num, help: "llama: physical micro-batch size" },
  { runtime: "llama.cpp", jsonName: "parallel",
    aliases: ["parallel", "n-parallel"],
    parse: num, help: "llama: parallel decoding slots" }
]

export function listKeys(runtime: RuntimeType): KeySpec[] {
  return KEYS.filter(k => k.runtime === runtime)
}

function findKey(runtime: RuntimeType, raw: string): KeySpec {
  const spec = KEYS.find(k => k.runtime === runtime && k.aliases.includes(raw))
  if (!spec) {
    const allowed = listKeys(runtime).map(k => k.aliases[0]).join(", ")
    throw new Error(`unknown ${runtime} preset key "${raw}". Known: ${allowed}`)
  }
  return spec
}

// Parses tokens like "ctx-size=32768". Each token must have exactly
// one "=".
export function parseKvTokens(tokens: string[]): Array<[string, string]> {
  const out: Array<[string, string]> = []
  for (const t of tokens) {
    const i = t.indexOf("=")
    if (i < 0) throw new Error(`expected key=value, got "${t}"`)
    out.push([t.slice(0, i).trim(), t.slice(i + 1).trim()])
  }
  return out
}

// Produces a new preset for an entry with the given kv pairs applied.
// Non-specified keys are preserved. A preset's runtime always matches
// the entry's runtime.
export function setPresetFields(
  entry: ModelEntry,
  kvs: Array<[string, string]>
): RuntimePreset {
  const runtime = entry.runtime
  const existing = (entry.preset && entry.preset.runtime === runtime)
    ? entry.preset
    : undefined

  const patch: Record<string, number> = {}
  for (const [k, v] of kvs) {
    const spec = findKey(runtime, k)
    patch[spec.jsonName] = spec.parse(v)
  }
  if (runtime === "mlx") {
    const base = existing && existing.runtime === "mlx" ? existing.mlx : {}
    return { runtime: "mlx", mlx: { ...base, ...patch } as Partial<MlxConfig> }
  }
  const base = existing && existing.runtime === "llama.cpp" ? existing.llama : {}
  return {
    runtime: "llama.cpp",
    llama: { ...base, ...patch } as Partial<LlamaConfig>
  }
}

export function unsetPresetFields(
  entry: ModelEntry,
  keys: string[]
): RuntimePreset | undefined {
  if (!entry.preset || entry.preset.runtime !== entry.runtime) return undefined
  const runtime = entry.runtime
  const drop = new Set(keys.map(k => findKey(runtime, k).jsonName))
  const preset = entry.preset
  if (runtime === "mlx" && preset.runtime === "mlx") {
    const next = { ...preset.mlx } as Record<string, unknown>
    for (const k of drop) delete next[k]
    if (Object.keys(next).length === 0) return undefined
    return { runtime: "mlx", mlx: next as Partial<MlxConfig> }
  }
  if (preset.runtime !== "llama.cpp") return undefined
  const next = { ...preset.llama } as Record<string, unknown>
  for (const k of drop) delete next[k]
  if (Object.keys(next).length === 0) return undefined
  return { runtime: "llama.cpp", llama: next as Partial<LlamaConfig> }
}
