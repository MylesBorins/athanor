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
import { runtimeModelId } from "./model-id.js"

export { runtimeModelId } from "./model-id.js"

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
  const active = entry.formula ?? entry.preset
  if (entry.runtime === "mlx") {
    const override =
      active && active.runtime === "mlx" ? active.mlx : {}
    return { ...cfg.mlx, ...override }
  }
  const override =
    active && active.runtime === "llama.cpp" ? active.llama : {}
  return { ...cfg.llama, ...override }
}

export function buildCommandFor(
  entry: ModelEntry
): { cmd: string; args: string[]; env?: Record<string, string> } {
  const adapter = getAdapter(entry.runtime)
  const merged = mergedConfigFor(entry)
  return adapter.buildCommand(entry, merged)
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
