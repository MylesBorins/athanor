import type {
  LlamaConfig,
  MlxConfig,
  ModelEntry,
  RuntimePreset,
  RuntimeType
} from "../types/index.js"

export interface KeySpec {
  runtime: RuntimeType
  jsonName: keyof MlxConfig | keyof LlamaConfig
  aliases: string[]
  type: "string" | "number"
  parse: (raw: string) => string | number
  help: string
}

function num(raw: string): number {
  const n = Number(raw)
  if (!Number.isFinite(n)) throw new Error(`expected a number, got "${raw}"`)
  return n
}

function float(raw: string): number {
  const n = Number(raw)
  if (!Number.isFinite(n)) throw new Error(`expected a number, got "${raw}"`)
  return n
}

function str(raw: string): string {
  return raw
}

const VALID_CACHE_TYPES = new Set(["f32", "f16", "bf16", "q8_0", "q4_0", "q4_1", "iq4_nl", "q5_0", "q5_1"])
function cacheType(raw: string): string {
  const val = raw.toLowerCase().trim()
  if (!VALID_CACHE_TYPES.has(val)) {
    throw new Error(`expected one of: ${Array.from(VALID_CACHE_TYPES).join(", ")}, got "${raw}"`)
  }
  return val
}

function flashAttn(raw: string): string {
  const val = raw.toLowerCase().trim()
  if (val === "on" || val === "true" || val === "1" || val === "enabled") return "on"
  if (val === "off" || val === "false" || val === "0" || val === "disabled") return "off"
  if (val === "auto") return "auto"
  throw new Error(`expected on, off, or auto, got "${raw}"`)
}

const KEYS: KeySpec[] = [
  { runtime: "mlx", jsonName: "prefillStepSize", type: "number",
    aliases: ["prefillStepSize", "prefill-step-size"],
    parse: num, help: "mlx: prefill step size" },
  { runtime: "mlx", jsonName: "promptCacheSize", type: "number",
    aliases: ["promptCacheSize", "prompt-cache-size"],
    parse: num, help: "mlx: prompt cache size (tokens)" },
  { runtime: "mlx", jsonName: "contextWindow", type: "number",
    aliases: ["contextWindow", "context-window"],
    parse: num, help: "mlx: advertised context window for pi-agent (tokens); not passed to mlx_lm.server" },
  { runtime: "mlx", jsonName: "maxTokens", type: "number",
    aliases: ["maxTokens", "max-tokens"],
    parse: num, help: "mlx: per-response output token cap passed as --max-tokens (mlx_lm.server default: 512)" },
  { runtime: "mlx", jsonName: "decodeConcurrency", type: "number",
    aliases: ["decodeConcurrency", "decode-concurrency"],
    parse: num, help: "mlx: parallel decode slots" },
  { runtime: "mlx", jsonName: "promptCacheBytes", type: "number",
    aliases: ["promptCacheBytes", "prompt-cache-bytes"],
    parse: num, help: "mlx: prompt cache memory cap (bytes). Prefer config parsing for gb/mb units" },
  { runtime: "mlx", jsonName: "temp", type: "number",
    aliases: ["temp", "temperature"],
    parse: float, help: "mlx: sampling temperature (0 = greedy, default 0)" },
  { runtime: "mlx", jsonName: "topP", type: "number",
    aliases: ["topP", "top-p"],
    parse: float, help: "mlx: nucleus sampling threshold (default 1; omitting 1.0 is harmless since it matches mlx-lm's default)" },
  { runtime: "mlx", jsonName: "topK", type: "number",
    aliases: ["topK", "top-k"],
    parse: num, help: "mlx: top-k sampling (0 = disabled, default 0)" },
  { runtime: "mlx", jsonName: "minP", type: "number",
    aliases: ["minP", "min-p"],
    parse: float, help: "mlx: minimum probability for top-p sampling (default 0)" },
  { runtime: "mlx", jsonName: "promptConcurrency", type: "number",
    aliases: ["promptConcurrency", "prompt-concurrency"],
    parse: num, help: "mlx: parallel prompt prefill slots (default 8)" },
  { runtime: "mlx", jsonName: "kvBits", type: "number",
    aliases: ["kvBits", "kv-bits"],
    parse: num, help: "mlx: KV cache quantization bit-width (8 or 4; 0 = unquantized)" },
  { runtime: "mlx", jsonName: "draftModel", type: "string",
    aliases: ["draftModel", "draft-model", "specDraftModel", "spec-draft-model"],
    parse: str, help: "mlx: path or HF repo of draft model for speculative decoding" },
  { runtime: "mlx", jsonName: "repeatPenalty", type: "number",
    aliases: ["repeatPenalty", "repeat-penalty", "repetitionPenalty", "repetition-penalty"],
    parse: float, help: "mlx: penalty for repeating token sequences (1.0 = disabled)" },
  { runtime: "mlx", jsonName: "presencePenalty", type: "number",
    aliases: ["presencePenalty", "presence-penalty"],
    parse: float, help: "mlx: presence penalty (0.0 = disabled)" },
  { runtime: "mlx", jsonName: "frequencyPenalty", type: "number",
    aliases: ["frequencyPenalty", "frequency-penalty"],
    parse: float, help: "mlx: frequency penalty (0.0 = disabled)" },
  { runtime: "mlx", jsonName: "reasoningEffort", type: "string",
    aliases: ["reasoningEffort", "reasoning-effort", "reasoning_effort", "effort"],
    parse: str, help: "mlx: reasoning effort for models with reasoning templates (e.g. low, medium, xhigh)" },

  { runtime: "llama.cpp", jsonName: "ctxSize", type: "number",
    aliases: ["ctxSize", "ctx-size", "n-ctx"],
    parse: num, help: "llama: context window (tokens)" },
  { runtime: "llama.cpp", jsonName: "nGpuLayers", type: "number",
    aliases: ["nGpuLayers", "n-gpu-layers", "ngl"],
    parse: num, help: "llama: layers offloaded to GPU (999 = all)" },
  { runtime: "llama.cpp", jsonName: "temp", type: "number",
    aliases: ["temp", "temperature"],
    parse: float, help: "llama: sampling temperature" },
  { runtime: "llama.cpp", jsonName: "topP", type: "number",
    aliases: ["topP", "top-p"],
    parse: float, help: "llama: nucleus sampling threshold" },
  { runtime: "llama.cpp", jsonName: "topK", type: "number",
    aliases: ["topK", "top-k"],
    parse: num, help: "llama: top-k sampling (0 = disabled)" },
  { runtime: "llama.cpp", jsonName: "minP", type: "number",
    aliases: ["minP", "min-p"],
    parse: float, help: "llama: minimum probability threshold" },
  { runtime: "llama.cpp", jsonName: "presencePenalty", type: "number",
    aliases: ["presencePenalty", "presence-penalty"],
    parse: float, help: "llama: presence penalty (0.0 = disabled)" },
  { runtime: "llama.cpp", jsonName: "repeatPenalty", type: "number",
    aliases: ["repeatPenalty", "repeat-penalty", "repetition-penalty", "repetitionPenalty"],
    parse: float, help: "llama: penalty for repeating token sequences (1.0 = disabled)" },
  { runtime: "llama.cpp", jsonName: "frequencyPenalty", type: "number",
    aliases: ["frequencyPenalty", "frequency-penalty"],
    parse: float, help: "llama: frequency penalty (0.0 = disabled)" },
  { runtime: "llama.cpp", jsonName: "batchSize", type: "number",
    aliases: ["batchSize", "batch-size"],
    parse: num, help: "llama: prompt batch size" },
  { runtime: "llama.cpp", jsonName: "ubatchSize", type: "number",
    aliases: ["ubatchSize", "ubatch-size"],
    parse: num, help: "llama: physical micro-batch size" },
  { runtime: "llama.cpp", jsonName: "parallel", type: "number",
    aliases: ["parallel", "n-parallel"],
    parse: num, help: "llama: parallel decoding slots" },
  { runtime: "llama.cpp", jsonName: "repeatLastN", type: "number",
    aliases: ["repeatLastN", "repeat-last-n"],
    parse: num, help: "llama: last n tokens to consider for repeat penalty (64 = default, 0 = disabled, -1 = context size)" },
  { runtime: "llama.cpp", jsonName: "specType", type: "string",
    aliases: ["specType", "spec-type"],
    parse: str, help: "llama: type of speculative decoding (e.g. draft-mtp, draft-simple, ngram-simple)" },
  { runtime: "llama.cpp", jsonName: "specDraftNMax", type: "number",
    aliases: ["specDraftNMax", "spec-draft-n-max"],
    parse: num, help: "llama: maximum draft tokens to predict" },
  { runtime: "llama.cpp", jsonName: "specDraftNMin", type: "number",
    aliases: ["specDraftNMin", "spec-draft-n-min"],
    parse: num, help: "llama: minimum draft tokens to predict" },
  { runtime: "llama.cpp", jsonName: "specDraftPSplit", type: "number",
    aliases: ["specDraftPSplit", "spec-draft-p-split"],
    parse: float, help: "llama: speculative decoding split probability" },
  { runtime: "llama.cpp", jsonName: "specDraftPMin", type: "number",
    aliases: ["specDraftPMin", "spec-draft-p-min"],
    parse: float, help: "llama: minimum speculative decoding probability" },
  { runtime: "llama.cpp", jsonName: "specDraftModel", type: "string",
    aliases: ["specDraftModel", "spec-draft-model"],
    parse: str, help: "llama: path/repo/file of draft model for speculative decoding" },
  { runtime: "llama.cpp", jsonName: "specDraftNgl", type: "number",
    aliases: ["specDraftNgl", "spec-draft-ngl", "ngl-draft"],
    parse: num, help: "llama: layers offloaded to GPU for draft model" },
  { runtime: "llama.cpp", jsonName: "speculativeMode", type: "string",
    aliases: ["speculativeMode", "speculative-mode"],
    parse: (raw: string) => {
      const val = raw.toLowerCase().trim()
      if (val !== "auto" && val !== "enabled" && val !== "disabled") {
        throw new Error("expected auto, enabled, or disabled")
      }
      return val
    }, help: "llama: speculative decoding mode (auto, enabled, disabled)" },
  { runtime: "llama.cpp", jsonName: "cacheTypeK", type: "string",
    aliases: ["cacheTypeK", "cache-type-k", "ctk"],
    parse: cacheType, help: "llama: KV cache key data type (f16, q8_0, q4_0, etc.)" },
  { runtime: "llama.cpp", jsonName: "cacheTypeV", type: "string",
    aliases: ["cacheTypeV", "cache-type-v", "ctv"],
    parse: cacheType, help: "llama: KV cache value data type (f16, q8_0, q4_0, etc.)" },
  { runtime: "llama.cpp", jsonName: "flashAttn", type: "string",
    aliases: ["flashAttn", "flash-attn", "fa"],
    parse: flashAttn, help: "llama: Flash Attention use (on, off, auto)" },
  { runtime: "llama.cpp", jsonName: "specDraftCacheTypeK", type: "string",
    aliases: ["specDraftCacheTypeK", "spec-draft-type-k", "cache-type-k-draft", "ctkd"],
    parse: cacheType, help: "llama: KV cache key data type for draft model" },
  { runtime: "llama.cpp", jsonName: "specDraftCacheTypeV", type: "string",
    aliases: ["specDraftCacheTypeV", "spec-draft-type-v", "cache-type-v-draft", "ctvd"],
    parse: cacheType, help: "llama: KV cache value data type for draft model" },
  { runtime: "llama.cpp", jsonName: "reasoningEffort", type: "string",
    aliases: ["reasoningEffort", "reasoning-effort", "reasoning_effort", "effort"],
    parse: str, help: "llama: reasoning effort for models with reasoning templates (e.g. low, medium, xhigh)" }
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
export function setFormulaFields(
  entry: ModelEntry,
  kvs: Array<[string, string]>
): RuntimePreset {
  const runtime = entry.runtime
  const active = entry.formula ?? entry.preset
  const existing = (active && active.runtime === runtime)
    ? active
    : undefined

  const patch: Record<string, string | number> = {}
  for (const [k, v] of kvs) {
    const spec = findKey(runtime, k)
    if (spec.jsonName === "reasoningEffort") {
      if (!entry.reasoningEffort || !entry.reasoningEffort.enum || entry.reasoningEffort.enum.length === 0) {
        throw new Error(`model "${entry.slug}" has no known reasoning_effort support`)
      }
      const parsedVal = String(spec.parse(v))
      if (!entry.reasoningEffort.enum.includes(parsedVal)) {
        throw new Error(`invalid reasoningEffort "${parsedVal}" for model "${entry.slug}". Supported values: ${entry.reasoningEffort.enum.join(", ")}`)
      }
      patch[spec.jsonName] = parsedVal
    } else {
      patch[spec.jsonName] = spec.parse(v)
    }
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

export const setPresetFields = setFormulaFields

export function unsetFormulaFields(
  entry: ModelEntry,
  keys: string[]
): RuntimePreset | undefined {
  const active = entry.formula ?? entry.preset
  if (!active || active.runtime !== entry.runtime) return undefined
  const runtime = entry.runtime
  const drop = new Set(keys.map(k => findKey(runtime, k).jsonName))
  if (runtime === "mlx" && active.runtime === "mlx") {
    const next = { ...active.mlx } as Record<string, unknown>
    for (const k of drop) delete next[k]
    if (Object.keys(next).length === 0) return undefined
    return { runtime: "mlx", mlx: next as Partial<MlxConfig> }
  }
  if (active.runtime !== "llama.cpp") return undefined
  const next = { ...active.llama } as Record<string, unknown>
  for (const k of drop) delete next[k]
  if (Object.keys(next).length === 0) return undefined
  return { runtime: "llama.cpp", llama: next as Partial<LlamaConfig> }
}

export const unsetPresetFields = unsetFormulaFields

export function validateLlamaSpeculativeConfig(merged: LlamaConfig, entry: ModelEntry): string[] {
  const warnings: string[] = []
  const { specType, specDraftModel, speculativeMode } = merged
  const isMtpCapable = entry.capabilities?.includes("mtp") || false

  if (speculativeMode === "enabled" && !isMtpCapable) {
    warnings.push("speculative-mode is set to 'enabled' but the model has no detected Multi-Token Prediction (MTP) capability.")
  }

  const mtpActive = (speculativeMode === "enabled") || (speculativeMode === "auto" && isMtpCapable)

  if (speculativeMode === "disabled" && isMtpCapable) {
    warnings.push("Model has Multi-Token Prediction (MTP) capability, but speculative-mode is set to 'disabled'. MTP will not be enabled.")
  }

  if (mtpActive) {
    if (specType && specType !== "draft-mtp" && specType !== "none") {
      warnings.push(`speculative-mode has active MTP, but spec-type is overridden to "${specType}".`)
    }
  } else {
    if (specType === undefined || specType === "none") {
      const hasSpecParams =
        merged.specDraftNMax !== undefined ||
        merged.specDraftNMin !== undefined ||
        merged.specDraftPSplit !== undefined ||
        merged.specDraftPMin !== undefined ||
        merged.specDraftModel !== undefined ||
        merged.specDraftNgl !== undefined

      if (hasSpecParams) {
        warnings.push(`spec-draft parameters are configured but speculative-mode is not enabled and spec-type is not set (or is "none"). Speculative decoding will not be active.`)
      }
    } else {
      if (specType === "draft" || specType === "draft-simple" || specType === "draft-eagle3" || specType === "draft-dflash") {
        if (!specDraftModel) {
          warnings.push(`spec-type "${specType}" requires a speculative draft model path set via spec-draft-model.`)
        }
      } else if (specType === "draft-mtp") {
        if (specDraftModel) {
          warnings.push(`spec-type "draft-mtp" (Multi-Token Prediction) does not require a separate spec-draft-model (draft heads are built-in). The specified model "${specDraftModel}" might be ignored.`)
        }
      }
    }
  }

  return warnings
}

export function validateLlamaReasoningConfig(merged: LlamaConfig, entry: ModelEntry): string[] {
  const warnings: string[] = []
  if (merged.reasoningEffort !== undefined) {
    if (!entry.reasoningEffort || !entry.reasoningEffort.enum || entry.reasoningEffort.enum.length === 0) {
      warnings.push(`reasoningEffort "${merged.reasoningEffort}" is configured, but model "${entry.slug}" has no detected reasoning effort support.`)
    } else if (!entry.reasoningEffort.enum.includes(merged.reasoningEffort)) {
      warnings.push(`reasoningEffort "${merged.reasoningEffort}" is not supported by model "${entry.slug}" (allowed: ${entry.reasoningEffort.enum.join(", ")}).`)
    }
  }
  return warnings
}
