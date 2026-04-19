import type {
  LlamaConfig,
  MlxConfig,
  ModelEntry,
  RuntimeAdapter,
  RuntimeType
} from "../types/index.js"
import { MlxAdapter } from "./mlx.js"
import { LlamaAdapter } from "./llama.js"
import { loadConfig } from "../config/index.js"

export const runtimes: Record<RuntimeType, RuntimeAdapter> = {
  "mlx": new MlxAdapter(),
  "llama.cpp": new LlamaAdapter()
}

export function getAdapter(runtime: RuntimeType): RuntimeAdapter {
  return runtimes[runtime]
}

export function inferRuntime(modelPath: string): RuntimeType | undefined {
  if (modelPath.endsWith(".gguf")) return "llama.cpp"
  if (/\bmlx\b/i.test(modelPath)) return "mlx"
  return undefined
}

export function mergedConfigFor(entry: ModelEntry): MlxConfig | LlamaConfig {
  const cfg = loadConfig()
  if (entry.runtime === "mlx") {
    const override =
      entry.preset && entry.preset.runtime === "mlx" ? entry.preset.mlx : {}
    return { ...cfg.mlx, ...override }
  }
  const override =
    entry.preset && entry.preset.runtime === "llama.cpp" ? entry.preset.llama : {}
  return { ...cfg.llama, ...override }
}

export function buildCommandFor(entry: ModelEntry): { cmd: string; args: string[] } {
  const adapter = getAdapter(entry.runtime)
  const merged = mergedConfigFor(entry)
  return adapter.buildCommand(entry, merged)
}

// Identifier the runtime accepts in OpenAI-compatible requests. Must
// match exactly what each runtime was launched with, otherwise:
//   - mlx_lm.server treats a mismatched "model" field as an HF repo
//     to download (see ml-explore/mlx-lm#1133),
//   - llama-server echoes whatever alias is configured via --alias in
//     its /v1/models response.
// pi's models.json uses this string as the model `id`.
export function runtimeModelId(entry: ModelEntry): string {
  if (entry.runtime === "mlx") {
    if (entry.source.type === "hf") return entry.source.repo
    return entry.path
  }
  return entry.piAlias ?? entry.slug
}

// Reverse lookup used by the router: given whatever pi-agent puts in a
// request body's `model` field, find the matching registry entry.
// Accepts runtimeModelId (primary), slug, and id as fallbacks so
// third-party OpenAI clients can target athanor models by slug too.
export function resolveByRuntimeModelId(
  entries: ModelEntry[],
  modelField: string
): ModelEntry | undefined {
  if (!modelField) return undefined
  const exposed = entries.filter(e => e.publish)
  return (
    exposed.find(e => runtimeModelId(e) === modelField) ??
    exposed.find(e => e.slug === modelField) ??
    exposed.find(e => e.id === modelField)
  )
}
