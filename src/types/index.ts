export type RuntimeType = "mlx" | "llama.cpp"

// Some MLX models (Qwen2-VL, Qwen2.5-VL, Llama-3.2-Vision, Pixtral,
// Phi-3-V, Idefics, LLaVA…) require mlx_vlm.server rather than
// mlx_lm.server. The `lm` loader raises on VLM configs. Flavor is
// detected at scan time from the snapshot's config.json.
export type MlxFlavor = "lm" | "vlm"

export type InstanceStatus =
  | "idle"
  | "starting"
  | "running"
  | "error"
  | "exited"

export type SupervisorPolicy = "single-active" | "multi-active-lru" | "manual"

export interface MlxConfig {
  prefillStepSize: number
  promptCacheSize: number
  decodeConcurrency: number
}

export interface LlamaConfig {
  nGpuLayers: number
  threads: number
  ctxSize: number
  batchSize: number
  ubatchSize: number
  parallel: number
}

export type RuntimePreset =
  | { runtime: "mlx"; mlx: Partial<MlxConfig> }
  | { runtime: "llama.cpp"; llama: Partial<LlamaConfig> }

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

export interface ModelEntry {
  id: string
  slug: string
  path: string
  runtime: RuntimeType
  source: ModelSource
  port: number
  preset?: RuntimePreset
  publish: boolean
  piAlias?: string
  tags?: string[]
  sizeBytes?: number
  addedAt: number
  lastUsedAt?: number
  // Only meaningful when runtime === "mlx". Absent or "lm" routes to
  // mlx_lm.server; "vlm" routes to mlx_vlm.server.
  mlxFlavor?: MlxFlavor
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
  exitCode?: number | null
  exitReason?: string
}

export interface RuntimeAdapter {
  type: RuntimeType

  buildCommand(
    entry: ModelEntry,
    merged: MlxConfig | LlamaConfig
  ): { cmd: string; args: string[] }

  healthUrl(port: number): string
}

export interface DiscoveredModel {
  id: string
  name: string
  path: string
  runtime: RuntimeType
  source: ModelSource
  sizeBytes?: number
  mlxFlavor?: MlxFlavor
}
