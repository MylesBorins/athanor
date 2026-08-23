export type RuntimeType = "mlx" | "llama.cpp"

// Some MLX models (Qwen2-VL, Qwen2.5-VL, Llama-3.2-Vision, Pixtral,
// Phi-3-V, Idefics, LLaVA…) ship with a vision tower and can be
// served via mlx_vlm.server. Many of the same repos also run fine as
// text-only under mlx_lm.server (no torch/torchvision required), so
// capability and flavor are kept as separate axes: capability is a
// detected fact, flavor is user intent.
export type MlxFlavor = "lm" | "vlm"
export type MlxCapability = "vlm"

export type InstanceStatus =
  | "idle"
  | "starting"
  | "running"
  | "error"
  | "exited"

export type SupervisorPolicy = "single-active" | "multi-active-lru" | "manual"

export interface MlxConfig {
  prefillStepSize: number
  // Application-level caching. Must not be treated as a proxy for
  // model context / KV cache size.
  promptCacheSize: number
  decodeConcurrency: number
  // Advertised context window (tokens). Used for pi-agent sync
  // (invariant #6) only — mlx_lm.server has no context-window flag;
  // the model's KV cache ceiling is determined by its weights.
  contextWindow: number
  // Per-response output cap. Passed to mlx_lm.server as --max-tokens.
  // mlx_lm.server's own default is 512; athanor raises this to a more
  // useful value by default.
  maxTokens: number
  // GPU prompt cache memory cap (bytes). Passed to mlx_lm.server as
  // --prompt-cache-bytes.
  promptCacheBytes: number
  // Sampling defaults — passed as CLI flags so the server uses them
  // as per-request fall-backs.  Clients may override per-request.
  temp: number
  topP: number
  topK: number
  minP: number
  promptConcurrency: number
  // KV cache quantization (e.g. 8 or 4 bits). Passed as --kv-bits.
  kvBits?: number
  // Speculative decoding draft model. Passed as --draft-model.
  draftModel?: string
  // Sampling penalties
  repeatPenalty?: number
  presencePenalty?: number
  frequencyPenalty?: number
  // Reasoning effort override for reasoning-capable models
  reasoningEffort?: string
}

export type LlamaSpecType =
  | "none"
  | "draft"
  | "draft-simple"
  | "draft-eagle3"
  | "draft-mtp"
  | "draft-dflash"
  | "ngram-simple"
  | "ngram-map-k"
  | "ngram-map-k4v"
  | "ngram-mod"
  | "ngram-cache"

export type LlamaCacheType =
  | "f32"
  | "f16"
  | "bf16"
  | "q8_0"
  | "q4_0"
  | "q4_1"
  | "iq4_nl"
  | "q5_0"
  | "q5_1"

export type LlamaFlashAttn = "on" | "off" | "auto"

export interface LlamaConfig {
  nGpuLayers: number
  ctxSize: number
  batchSize: number
  ubatchSize: number
  parallel: number
  temp?: number
  topP?: number
  topK?: number
  minP?: number
  repeatPenalty?: number
  presencePenalty?: number
  frequencyPenalty?: number
  repeatLastN?: number
  cacheTypeK?: LlamaCacheType | (string & {})
  cacheTypeV?: LlamaCacheType | (string & {})
  flashAttn?: LlamaFlashAttn | (string & {})
  specType?: LlamaSpecType | (string & {})
  specDraftNMax?: number
  specDraftNMin?: number
  specDraftPSplit?: number
  specDraftPMin?: number
  specDraftModel?: string
  specDraftNgl?: number
  specDraftCacheTypeK?: LlamaCacheType | (string & {})
  specDraftCacheTypeV?: LlamaCacheType | (string & {})
  speculativeMode?: "auto" | "enabled" | "disabled"
  reasoningEffort?: string
}

export type RuntimeFormula =
  | { runtime: "mlx"; mlx: Partial<MlxConfig> }
  | { runtime: "llama.cpp"; llama: Partial<LlamaConfig> }

export type RuntimePreset = RuntimeFormula

export interface Formula {
  name: string
  description: string
  mlx?: Partial<MlxConfig>
  llama?: Partial<LlamaConfig>
  source?: "builtin" | "user"
}

export type Recipe = Formula

export interface ModelSourceHF {
  type: "hf"
  repo: string
  revision?: string
  file?: string
}

export interface ModelSourceLocal {
  type: "local"
}

export type ModelSource = ModelSourceHF | ModelSourceLocal

export type MetadataSource = "gguf_header" | "mlx_config" | "file_size_only"

export interface ReasoningEffortCapability {
  enum: string[]
  templateDefault: string
  athanorDefault: string
}

export type ModelCapability = "vlm" | "mtp" | "reasoning_effort"

export interface ModelEntry {
  id: string
  slug: string
  path: string
  runtime: RuntimeType
  source: ModelSource
  port: number
  formula?: RuntimeFormula
  preset?: RuntimePreset
  publish: boolean
  piAlias?: string
  tags?: string[]
  sizeBytes?: number
  addedAt: number
  lastUsedAt?: number
  // Only meaningful when runtime === "mlx". Absent or "lm" routes to
  // mlx_lm.server; "vlm" routes to mlx_vlm.server. User intent —
  // never mutated by discovery.
  mlxFlavor?: MlxFlavor
  // Detected facts about the model (refreshed by scan/pull). Today
  // only "vlm" — present when config.json has a vision tower.
  mlxCapabilities?: MlxCapability[]
  // General capabilities detected across runtimes (e.g. "vlm", "mtp", "reasoning_effort")
  capabilities?: ModelCapability[]
  // Reasoning effort capability details if supported by the model
  reasoningEffort?: ReasoningEffortCapability
  // Additional detected metadata used for recommendation guidance.
  // Refreshed by scan/pull when cheaply derivable from local files.
  architectureFamily?: string
  trainedContextLength?: number
  quantization?: string
  paramCount?: number
  isMoe?: boolean
  activeParams?: number
  metadataSource?: MetadataSource
}

export interface Registry {
  version: 1
  models: ModelEntry[]
}

export interface ActiveInstance {
  id: string
  slug: string
  runtime: RuntimeType
  port: number
  pid: number
  startedAt: number
  status: InstanceStatus
  logFile: string
  spawnStartedAt?: number
  spawnedAt?: number
  healthyAt?: number
  exitCode?: number | null
  exitReason?: string
}

export interface RuntimeAdapter {
  type: RuntimeType

  buildCommand(
    entry: ModelEntry,
    merged: MlxConfig | LlamaConfig
  ): { cmd: string; args: string[]; env?: Record<string, string> }

  healthUrl(port: number): string
}

export interface DiscoveredModel {
  id: string
  name: string
  path: string
  runtime: RuntimeType
  source: ModelSource
  sizeBytes?: number
  mlxCapabilities?: MlxCapability[]
  capabilities?: ModelCapability[]
  reasoningEffort?: ReasoningEffortCapability
  architectureFamily?: string
  trainedContextLength?: number
  quantization?: string
  paramCount?: number
  isMoe?: boolean
  activeParams?: number
  metadataSource?: MetadataSource
}

export interface TelemetryRecord {
  id: string
  modelId: string
  slug: string
  runtime: RuntimeType
  quantization?: string
  presetName?: string
  timestamp: number // Epoch ms
  promptTokens: number
  generatedTokens: number
  promptThroughput?: number // tokens/sec
  generationThroughput: number // tokens/sec
  timeToFirstTokenMs?: number
  totalDurationMs: number
  effectiveThroughput: number // (prompt + gen) / duration(s)
  contextSize?: number
  contextUtilization?: number // (prompt + gen) / contextSize
  peakMemoryBytes?: number
  runtimeSpecific?: {
    llama?: {
      speculativeAcceptanceRate?: number
      speculativeEnabled?: boolean
      mtpEnabled?: boolean
      meanDraftLength?: number
    }
    mlx?: {
      compilationTimeMs?: number
    }
  }
}

